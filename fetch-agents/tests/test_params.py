"""Order params: real Greenhouse calls for board checks, real ASI-1 and SpacetimeDB calls where keys exist."""

import os
from uuid import uuid4

import pytest

from front_desk import params, stdb

OPEN_ROLES = {
    "name": "open-roles",
    "description": "Open roles at any company with a public Greenhouse job board.",
    "inputs": {"board": {"type": "string", "description": "Greenhouse board token", "default": "discord"}},
    "sources": ["https://boards-api.greenhouse.io/v1/boards/{board}/departments"],
}


def test_slug_candidates():
    assert params.slug_candidates("Lattice") == ["lattice"]
    assert params.slug_candidates("Scale AI") == ["scale-ai", "scaleai"]
    assert params.slug_candidates("  !!! ") == []


def test_lattice_board_exists_and_fits():
    res = params.resolve_values(OPEN_ROLES, {"board": "Lattice"})
    assert res.params == {"board": "lattice"}, res
    assert "`lattice`" in res.note


def test_collapsed_slug_is_tried():
    # scale-ai is a 404 on Greenhouse; the board is scaleai. Its page is too large, so it is not attached.
    res = params.resolve_values(OPEN_ROLES, {"board": "Scale AI"})
    assert "`scaleai`" in res.note and res.params == {}, res


def test_made_up_company_is_not_found():
    name = f"Zzqx Nonexistent {uuid4().hex[:8]}"
    res = params.resolve_values(OPEN_ROLES, {"board": name})
    assert res.params == {} and "couldn't find" in res.note, res


def test_stripe_board_is_too_large():
    assert params.page_chars("https://boards-api.greenhouse.io/v1/boards/stripe/departments") > params.MAX_PAGE_CHARS
    res = params.resolve_values(OPEN_ROLES, {"board": "Stripe"})
    assert res.params == {} and res.note.startswith("Counteroffer"), res


def test_undeclared_keys_are_dropped():
    res = params.resolve_values(OPEN_ROLES, {"board": "Lattice", "region": "us"})
    assert res.params == {"board": "lattice"}


@pytest.mark.skipif(not os.environ.get("ASI1_API_KEY") or not os.environ.get("SPACETIME_HOST"),
                    reason="needs ASI1_API_KEY and SPACETIME_HOST")
def test_live_catalog_routes_lattice_to_open_roles():
    apis = stdb.catalog()
    assert "open-roles" in {a["name"] for a in apis}
    assert not any(a["name"].startswith("test-") for a in apis), "retired APIs must be skipped"
    res = params.resolve("open roles by team at Lattice", apis)
    assert res.api == "open-roles" and res.params == {"board": "lattice"}, res


@pytest.mark.skipif(not os.environ.get("ASI1_API_KEY") or not os.environ.get("SPACETIME_HOST"),
                    reason="needs ASI1_API_KEY and SPACETIME_HOST")
def test_live_catalog_no_params_for_gpu_request():
    res = params.resolve("RTX 5080 listings on Newegg with price and stock", stdb.catalog())
    assert res.params == {}, res
