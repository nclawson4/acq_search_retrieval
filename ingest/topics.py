"""Closed-set taxonomies used at ingest time and search time.

Editors assembling compilation clips need precise filters. The labels here
are the universe the LLM tagger and the search-side filter extractor are
both constrained to. Changing a label is a breaking change — re-tag all
sessions.
"""
from __future__ import annotations

# Topics: what the conversation is *about*. A session carries 1-3.
TOPICS: list[str] = [
    # Acquisition & Sales
    "lead_generation",
    "sales_process_and_closing",
    "sales_team_building",
    "customer_retention_and_churn",
    "marketing_attribution",
    # Offer & Pricing
    "pricing_strategy",
    "offer_and_productization",
    "recurring_revenue_and_continuity",
    # Brand & Distribution
    "personal_brand_and_content",
    "word_of_mouth_and_referrals",
    # Team & Operations
    "hiring_and_firing",
    "culture_and_team_management",
    "sops_systems_and_fulfillment",
    "founder_to_operator_transition",
    # Scale & Strategy
    "identifying_the_constraint",
    "multi_location_expansion",
    "franchising",
    "acquisitions_and_rollups",
    "multiple_businesses_and_focus",
    "pivoting_and_new_offerings",
    # Money & Capital
    "raising_capital",
    "debt_and_cash_flow",
    "personal_finance_and_founder_pay",
    "exits_and_selling",
    # Founder Mindset
    "time_management_and_priorities",
    "ai_and_tech_disruption",
]

TOPIC_LABELS: dict[str, str] = {
    "lead_generation": "Lead generation (paid, inbound, outbound)",
    "sales_process_and_closing": "Sales process & closing",
    "sales_team_building": "Sales team — hiring, training, comp",
    "customer_retention_and_churn": "Customer retention & churn",
    "marketing_attribution": "Marketing attribution & measurement",
    "pricing_strategy": "Pricing strategy",
    "offer_and_productization": "Offer construction & productization",
    "recurring_revenue_and_continuity": "Recurring revenue & continuity",
    "personal_brand_and_content": "Personal brand & content marketing",
    "word_of_mouth_and_referrals": "Word-of-mouth & referrals",
    "hiring_and_firing": "Hiring & firing (non-sales)",
    "culture_and_team_management": "Culture & team management",
    "sops_systems_and_fulfillment": "SOPs, systems, fulfillment",
    "founder_to_operator_transition": "Founder-to-operator transition",
    "identifying_the_constraint": "Identifying the constraint / scaling diagnosis",
    "multi_location_expansion": "Multi-location & geographic expansion",
    "franchising": "Franchising",
    "acquisitions_and_rollups": "Acquisitions, rollups & M&A",
    "multiple_businesses_and_focus": "Multiple businesses & focus",
    "pivoting_and_new_offerings": "Pivoting, new offerings, verticalization",
    "raising_capital": "Raising capital & investors",
    "debt_and_cash_flow": "Debt strategy & cash flow",
    "personal_finance_and_founder_pay": "Personal finance & founder pay",
    "exits_and_selling": "Exits & selling the business",
    "time_management_and_priorities": "Time management & saying no",
    "ai_and_tech_disruption": "AI / technology disruption",
}

# Revenue bands. Editors care about the upper end (most useful split there).
REVENUE_BANDS: list[str] = ["<$1M", "$1-5M", "$5-25M", "$25M+", "unknown"]

# Industries. Closed set drawn from the existing corpus + adjacent categories
# an editor would reasonably expect.
INDUSTRIES: list[str] = [
    "agency",                 # marketing, sales, design, web agencies
    "e_commerce",             # DTC product brands
    "saas_and_software",
    "ai_and_tech",
    "real_estate",
    "construction_and_trades",
    "home_services",          # HVAC, plumbing, cleaning, pest control, etc.
    "health_and_wellness",    # med spas, gyms, nutrition, mental health
    "professional_services",  # legal, tax, accounting, consulting
    "financial_services",
    "food_and_beverage",      # restaurants, CPG food, beverage brands
    "hospitality_and_travel", # hotels, motels, travel
    "retail_and_brick_mortar",
    "education_and_coaching",
    "creator_and_media",      # YouTubers, podcasters, content businesses
    "manufacturing",
    "automotive",
    "logistics_and_transport",
    "franchise_operator",     # multi-unit franchise owners
    "other",
]

INDUSTRY_LABELS: dict[str, str] = {
    "agency": "Agency (marketing, sales, design, web)",
    "e_commerce": "E-commerce / DTC",
    "saas_and_software": "SaaS & software",
    "ai_and_tech": "AI / tech",
    "real_estate": "Real estate",
    "construction_and_trades": "Construction & trades",
    "home_services": "Home services (HVAC, cleaning, etc.)",
    "health_and_wellness": "Health & wellness (med spa, gym, etc.)",
    "professional_services": "Professional services (legal, tax, consulting)",
    "financial_services": "Financial services",
    "food_and_beverage": "Food & beverage",
    "hospitality_and_travel": "Hospitality & travel",
    "retail_and_brick_mortar": "Retail / brick & mortar",
    "education_and_coaching": "Education & coaching",
    "creator_and_media": "Creator / media",
    "manufacturing": "Manufacturing",
    "automotive": "Automotive",
    "logistics_and_transport": "Logistics & transport",
    "franchise_operator": "Franchise operator",
    "other": "Other",
}

GENDERS: list[str] = ["male", "female", "unknown"]
