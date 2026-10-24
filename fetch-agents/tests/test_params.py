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
YC_DIRECTORY = {
    "name": "yc-directory",
    "description": "One Y Combinator company's public page.",
    "inputs": {"company": {"type": "string", "description": "YC company slug", "default": "airbnb"}},
    "sources": ["https://www.ycombinator.com/companies/{company}"],
}
GPU_LISTINGS = {
    "name": "gpu-listings",
    "description": "GPU listings on Newegg for a search query.",
    "inputs": {"query": {"type": "string", "description": "Newegg search, words joined by hyphens", "default": "rtx-5080"}},
    "sources": ["https://www.newegg.com/p/pl?d={query}"],
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


def test_non_greenhouse_params_become_slugs():
    assert params.resolve_values(YC_DIRECTORY, {"company": "Stripe"}).params == {"company": "stripe"}
    assert params.resolve_values(GPU_LISTINGS, {"query": "RTX 4090"}).params == {"query": "rtx-4090"}


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
def test_live_catalog_routes_gpu_query():
    res = params.resolve("RTX 4090 listings on Newegg with price and stock", stdb.catalog())
    assert res.api == "gpu-listings" and res.params == {"query": "rtx-4090"}, res


@pytest.mark.skipif(not os.environ.get("ASI1_API_KEY") or not os.environ.get("SPACETIME_HOST"),
                    reason="needs ASI1_API_KEY and SPACETIME_HOST")
def test_live_catalog_routes_yc_company():
    res = params.resolve("Stripe's Y Combinator company page: batch, status and one-liner", stdb.catalog())
    assert res.api == "yc-directory" and res.params == {"company": "stripe"}, res
