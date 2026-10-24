from front_desk.gate import blocked_domain_check, page_cap_check, personal_data_check, run_layer2

BLOCKED = ["linkedin.com", "facebook.com", "instagram.com"]


def test_engineer_emails_rejected():
    r = personal_data_check(["email"], "Emails of engineers at Stripe")
    assert not r.passed and r.check == "personal_data"


def test_names_of_employees_in_text_rejected():
    r = personal_data_check([], "list the names of employees on the Stripe payments team")
    assert not r.passed


def test_founder_linkedin_rejected():
    assert not personal_data_check(["company", "founder linkedin profile"]).passed


def test_linkedin_job_posts_pass():
    # Founder decision (Gate 1): LinkedIn is not blocked; only person-level data from it is.
    r = personal_data_check(["title", "team", "location"], "Open roles at Stripe on LinkedIn by team")
    assert r.passed, r


def test_linkedin_urls_of_engineers_rejected():
    assert not personal_data_check([], "LinkedIn URLs of engineers at Stripe").passed


def test_phone_numbers_rejected():
    assert not personal_data_check(["phone number", "store"]).passed


def test_gpu_listings_pass():
    r = personal_data_check(["name", "price", "stock", "link"], "RTX GPU listings from Newegg, Micro Center, B&H: price, stock, link")
    assert r.passed


def test_yc_directory_passes():
    r = personal_data_check(["company name", "website", "one-liner"], "YC W26 companies with website and one-liner")
    assert r.passed


def test_open_roles_counts_pass():
    r = personal_data_check(["team", "location", "open role count"], "Open roles by team at Stripe, counts by team and location")
    assert r.passed


def test_business_fields_not_flagged():
    assert personal_data_check(["company profile", "store address", "product name"]).passed


def test_blocked_domain_and_subdomain():
    assert not blocked_domain_check(["https://www.linkedin.com/company/stripe/jobs"], BLOCKED).passed
    assert not blocked_domain_check(["m.facebook.com/somepage"], BLOCKED).passed


def test_lookalike_domain_not_blocked():
    assert blocked_domain_check(["https://notlinkedin.com/x"], BLOCKED).passed


def test_allowed_domains_pass():
    assert blocked_domain_check(["https://www.newegg.com/p/pl?d=rtx", "boards.greenhouse.io/stripe"], BLOCKED).passed


def test_page_cap_counteroffer():
    r = page_cap_check(5000, 25)
    assert not r.passed and r.counteroffer_pages == 25


def test_layer2_order_personal_data_first():
    r = run_layer2(fields=["email"], sources=["linkedin.com"], request_text="", estimated_pages=1000,
                   blocked_domains=BLOCKED, page_cap=25)
    assert r.check == "personal_data"


def test_layer2_pass():
    r = run_layer2(fields=["price"], sources=["newegg.com"], request_text="GPU prices", estimated_pages=3,
                   blocked_domains=BLOCKED, page_cap=25)
    assert r.passed
