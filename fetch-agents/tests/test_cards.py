import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from front_desk.cards import card_metadata, order_card, parse_selection, quote_card, quote_is_fresh


@pytest.fixture(scope='module', autouse=True)
def isolated_agent_loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    old_seed = os.environ.get('FRONT_DESK_SEED')
    os.environ['FRONT_DESK_SEED'] = 'unit-test-card-handler-only'
    yield
    for task in asyncio.all_tasks(loop):
        task.cancel()
    loop.run_until_complete(asyncio.gather(*asyncio.all_tasks(loop), return_exceptions=True))
    loop.close()
    asyncio.set_event_loop(None)
    if old_seed is None:
        os.environ.pop('FRONT_DESK_SEED', None)
    else:
        os.environ['FRONT_DESK_SEED'] = old_seed


def quote(age=0):
    return {"ref": "test", "order_id": 3, "summary": "Open roles", "sources": ["https://example.com"],
            "fields": ["team"], "cents": 100, "quoted_at": (datetime.now(timezone.utc) - timedelta(minutes=age)).isoformat()}


def test_metadata_and_review():
    meta = quote_card(quote(), "1 page", True)
    assert all(isinstance(v, str) for v in meta.values())
    payload = json.loads(meta['card_payload'])
    assert meta['card_kind'] == 'review'
    assert payload['approve_cta']['selection'] == {"action": "forge:pay:3"}
    assert 'SIMULATED PAYMENT' in payload['summary_rows'][3]['value']
    assert payload['approve_cta']['label'] == 'Run demo'
    assert json.loads(quote_card(quote(), '1 page', False)['card_payload'])['approve_cta']['label'] == 'Pay'
    with pytest.raises(ValueError):
        card_metadata('detail', {'x': 'a' * 60_001})


def test_large_order_is_bounded_and_unverified_values_are_not_facts():
    values = [{"row": n, "entity": "e", "metric": "team", "value": "unproven", "status": "unverifiable"} for n in range(500)]
    meta = order_card({"id": 3, "status": "delivered", "price_cents": 100}, values, 'open-roles', [])
    assert len(meta['card_payload'].encode()) < 60_000
    assert 'unproven' not in meta['card_payload']
    assert '0/500 verified' in meta['card_payload']


def test_order_card_groups_fields_into_records():
    values = [{'row': row, 'metric': metric, 'value': f'{metric}-{row}', 'status': 'verified'}
              for row in range(7) for metric in ['title', 'team', 'location']]
    payload = json.loads(order_card({'id': 3, 'status': 'delivered', 'price_cents': 100}, values, 'open-roles', [])['card_payload'])
    preview = [r for r in payload['summary_rows'] if r['label'].startswith('Row ')]
    assert len(preview) == 3
    assert preview[0]['label'] == 'Row 0'
    assert all(f'{metric}: {metric}-0' in preview[0]['value'] for metric in ['title', 'team', 'location'])


@pytest.mark.parametrize('text,expected', [
    ('forge:pay:3', ('pay', 3)), ('{"selection":{"action":"forge:cancel:3"}}', ('cancel', 3)),
    ('User tapped forge:challenge:3.', ('challenge', 3)), ('forge:status', ('status', None)),
    ('garbage', None), ('forge:pay:3 and forge:pay:4', None), ('forge:pay:3evil', None),
])
def test_parse_selection(text, expected):
    assert parse_selection(text) == expected


def test_expiry():
    assert quote_is_fresh(quote())
    assert not quote_is_fresh(quote(31))
    assert not quote_is_fresh({})
    assert not quote_is_fresh(quote(-1))


def agent_module():
    os.environ.setdefault('FRONT_DESK_SEED', 'unit-test-card-handler-only')
    from front_desk import agent
    return agent


def test_status_excludes_old_challenges_and_details_require_owned_order(monkeypatch):
    agent = agent_module()
    orders = [{'id': 206, 'status': 'running', 'price_cents': 100, 'api_id': None}, {'id': 202}]
    monkeypatch.setattr(agent.stdb, 'orders_for_sender', lambda _: orders)
    monkeypatch.setattr(agent.stdb, 'value_records', lambda _: [])
    monkeypatch.setattr(agent.stdb, 'refunds_for_order', lambda _: [])
    def challenges(ids):
        assert ids in ([206], [202])
        return [{'id': 14, 'status': 'rejected'}] if ids == [202] else []
    monkeypatch.setattr(agent.stdb, 'challenges_for_orders', challenges)
    monkeypatch.setattr(agent, '_challenge_text', lambda c: 'saved quote and ruling')
    body, _ = agent._status_data('sender')
    assert 'Challenge' not in body and '#202' not in body
    assert agent._challenge_details('sender', 202) == 'saved quote and ruling'
    assert "can't find" in agent._challenge_details('sender', 999)


@pytest.mark.parametrize('word', ['ok', 'yes', 'accept', 'buy'])
def test_confirmation_never_pays(monkeypatch, word):
    agent = agent_module()
    payment, reply = AsyncMock(), AsyncMock()
    monkeypatch.setattr(agent, 'request_payment', payment)
    monkeypatch.setattr(agent, 'reply', reply)
    ctx = SimpleNamespace(send=AsyncMock(), storage=SimpleNamespace(get=lambda _: quote()), logger=SimpleNamespace(info=lambda _: None))
    asyncio.run(agent.on_chat(ctx, 'unit-sender', agent._text(word)))
    payment.assert_not_awaited()
    assert 'tap Pay' in reply.call_args.args[2]


def test_fresh_payment_and_expired_payment(monkeypatch):
    agent = agent_module()
    payment, reply = AsyncMock(), AsyncMock()
    monkeypatch.setattr(agent, '_request_payment', payment)
    monkeypatch.setattr(agent, 'reply', reply)
    ctx = SimpleNamespace(storage=SimpleNamespace(remove=lambda _: None))
    asyncio.run(agent.request_payment(ctx, 'unit-sender', quote()))
    payment.assert_awaited_once()
    payment.reset_mock()
    asyncio.run(agent.request_payment(ctx, 'unit-sender', quote(31)))
    payment.assert_not_awaited()
    assert 'expired' in reply.call_args.args[2]


def test_selection_must_match_senders_quote(monkeypatch):
    agent = agent_module()
    payment, reply = AsyncMock(), AsyncMock()
    monkeypatch.setattr(agent, 'request_payment', payment)
    monkeypatch.setattr(agent, 'reply', reply)
    ctx = SimpleNamespace(storage=SimpleNamespace(get=lambda _: quote()))
    asyncio.run(agent.handle_selection(ctx, 'unit-sender', ('pay', 99)))
    payment.assert_not_awaited()


def test_message_keeps_text_fallback():
    agent = agent_module()
    message = agent._text('full fallback', card=quote_card(quote(), '1 page', False))
    assert message.content[0].text == 'full fallback'
    assert message.content[1].metadata['card_kind'] == 'review'


def test_catalog_and_challenge_form():
    from front_desk.cards import catalog_card, challenge_form, parse_challenge_fields
    meta = catalog_card([{'id': 1, 'name': 'open-roles', 'description': 'public counts', 'tier': 1}])
    assert meta['card_kind'] == 'carousel'
    assert parse_selection(json.dumps(json.loads(meta['card_payload'])['items'][0]['primary_cta']['selection'])) == ('api', 1)
    form = json.loads(challenge_form(3, ['team'])['card_payload'])
    assert form['fields'][1]['options'] == [{'value': 'team', 'label': 'team'}]
    assert parse_challenge_fields('{"row":3,"metric":"team","reason":"wrong department"}') == (3, 'team', 'wrong department')
    for invalid in ['{}', '{"row":-1}', '{"row":true,"metric":"team","reason":"x"}', '{"row":1.5,"metric":"team","reason":"x"}']:
        assert parse_challenge_fields(invalid) is None


def test_form_field_stays_explicit_even_when_reason_mentions_another_field(monkeypatch):
    agent = agent_module()
    monkeypatch.setattr(agent.stdb, 'orders_for_sender', lambda _: [{'id': 3, 'status': 'delivered'}])
    monkeypatch.setattr(agent.stdb, 'value_records', lambda _: [{'metric': 'team'}, {'metric': 'location'}])
    handler = AsyncMock()
    monkeypatch.setattr(agent, 'handle_challenge', handler)
    ctx = SimpleNamespace(storage=SimpleNamespace(get=lambda _: None))
    asyncio.run(agent.handle_selection(ctx, 'unit-sender', ('recheck', 3), '{"row":2,"metric":"team","reason":"location was used as team"}'))
    challenge = handler.call_args.args[2]
    assert challenge.metric == 'team' and challenge.row == 2 and challenge.order_id == 3


def test_repeated_pay_emits_only_one_request(monkeypatch):
    agent = agent_module()
    monkeypatch.setattr(agent, 'demo_pay_enabled', lambda: False)
    checkout = {'checkout_session_id': 'cs_test_unit', 'client_secret': 'unit-test-only', 'publishable_key': 'pk_test_unit'}
    monkeypatch.setattr(agent, 'create_checkout', lambda **_: checkout)
    send, reply = AsyncMock(), AsyncMock()
    monkeypatch.setattr(agent, 'send', send)
    monkeypatch.setattr(agent, 'reply', reply)
    class Storage(dict):
        def set(self, key, value):
            self[key] = value
    ctx = SimpleNamespace(storage=Storage(), logger=SimpleNamespace(exception=lambda _: None))
    asyncio.run(agent.request_payment(ctx, 'unit-sender', quote()))
    asyncio.run(agent.request_payment(ctx, 'unit-sender', quote()))
    send.assert_awaited_once()
    assert send.call_args.args[3] == 'RequestPayment'
