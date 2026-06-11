// Mirror of ingest/topics.py. Keep these arrays in sync — both sides must agree
// on the closed-set vocabulary used at tagging time and search time.

export const TOPICS = [
  "lead_generation",
  "sales_process_and_closing",
  "sales_team_building",
  "customer_retention_and_churn",
  "marketing_attribution",
  "pricing_strategy",
  "offer_and_productization",
  "recurring_revenue_and_continuity",
  "personal_brand_and_content",
  "word_of_mouth_and_referrals",
  "hiring_and_firing",
  "culture_and_team_management",
  "sops_systems_and_fulfillment",
  "founder_to_operator_transition",
  "identifying_the_constraint",
  "multi_location_expansion",
  "franchising",
  "acquisitions_and_rollups",
  "multiple_businesses_and_focus",
  "pivoting_and_new_offerings",
  "raising_capital",
  "debt_and_cash_flow",
  "personal_finance_and_founder_pay",
  "exits_and_selling",
  "time_management_and_priorities",
  "ai_and_tech_disruption",
] as const;

export const TOPIC_LABELS: Record<string, string> = {
  lead_generation: "Lead generation (paid, inbound, outbound)",
  sales_process_and_closing: "Sales process & closing",
  sales_team_building: "Sales team — hiring, training, comp",
  customer_retention_and_churn: "Customer retention & churn",
  marketing_attribution: "Marketing attribution & measurement",
  pricing_strategy: "Pricing strategy",
  offer_and_productization: "Offer construction & productization",
  recurring_revenue_and_continuity: "Recurring revenue & continuity",
  personal_brand_and_content: "Personal brand & content marketing",
  word_of_mouth_and_referrals: "Word-of-mouth & referrals",
  hiring_and_firing: "Hiring & firing (non-sales)",
  culture_and_team_management: "Culture & team management",
  sops_systems_and_fulfillment: "SOPs, systems, fulfillment",
  founder_to_operator_transition: "Founder-to-operator transition",
  identifying_the_constraint: "Identifying the constraint / scaling diagnosis",
  multi_location_expansion: "Multi-location & geographic expansion",
  franchising: "Franchising",
  acquisitions_and_rollups: "Acquisitions, rollups & M&A",
  multiple_businesses_and_focus: "Multiple businesses & focus",
  pivoting_and_new_offerings: "Pivoting, new offerings, verticalization",
  raising_capital: "Raising capital & investors",
  debt_and_cash_flow: "Debt strategy & cash flow",
  personal_finance_and_founder_pay: "Personal finance & founder pay",
  exits_and_selling: "Exits & selling the business",
  time_management_and_priorities: "Time management & saying no",
  ai_and_tech_disruption: "AI / technology disruption",
};

export const REVENUE_BANDS = ["<$1M", "$1-5M", "$5-25M", "$25M+", "unknown"] as const;

export const INDUSTRIES = [
  "agency",
  "e_commerce",
  "saas_and_software",
  "ai_and_tech",
  "real_estate",
  "construction_and_trades",
  "home_services",
  "health_and_wellness",
  "professional_services",
  "financial_services",
  "food_and_beverage",
  "hospitality_and_travel",
  "retail_and_brick_mortar",
  "education_and_coaching",
  "creator_and_media",
  "manufacturing",
  "automotive",
  "logistics_and_transport",
  "franchise_operator",
  "other",
] as const;

export const INDUSTRY_LABELS: Record<string, string> = {
  agency: "Agency (marketing, sales, design, web)",
  e_commerce: "E-commerce / DTC",
  saas_and_software: "SaaS & software",
  ai_and_tech: "AI / tech",
  real_estate: "Real estate",
  construction_and_trades: "Construction & trades",
  home_services: "Home services (HVAC, cleaning, etc.)",
  health_and_wellness: "Health & wellness (med spa, gym, etc.)",
  professional_services: "Professional services (legal, tax, consulting)",
  financial_services: "Financial services",
  food_and_beverage: "Food & beverage",
  hospitality_and_travel: "Hospitality & travel",
  retail_and_brick_mortar: "Retail / brick & mortar",
  education_and_coaching: "Education & coaching",
  creator_and_media: "Creator / media",
  manufacturing: "Manufacturing",
  automotive: "Automotive",
  logistics_and_transport: "Logistics & transport",
  franchise_operator: "Franchise operator",
  other: "Other",
};

export const GENDERS = ["male", "female", "unknown"] as const;

export type Topic = (typeof TOPICS)[number];
export type RevenueBand = (typeof REVENUE_BANDS)[number];
export type Industry = (typeof INDUSTRIES)[number];
export type Gender = (typeof GENDERS)[number];
