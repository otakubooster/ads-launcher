/** Choices the preset, copy and launch screens offer. Browser-safe. */

/**
 * Advantage+ creative features set one by one in
 * degrees_of_freedom_spec.creative_features_spec (the old standard_enhancements
 * bundle is gone since v22.0).
 */
export const CREATIVE_FEATURES = [
  { key: "image_touchups", label: "Visual touch-ups", hint: "Automatic cropping and filters" },
  { key: "image_brightness_and_contrast", label: "Brightness and contrast" },
  { key: "text_optimizations", label: "Text improvements", hint: "Swaps primary text, headline and description" },
  { key: "enhance_cta", label: "Enhance CTA" },
  { key: "image_templates", label: "Add overlays", hint: "Frames and text on images" },
  { key: "video_auto_crop", label: "Video auto-crop" },
  { key: "adapt_to_placement", label: "Adapt to placement" },
  { key: "inline_comment", label: "Show relevant comments" },
  { key: "description_automation", label: "Dynamic description" },
  { key: "music", label: "Add music" },
] as const;
export type CreativeFeatureKey = (typeof CREATIVE_FEATURES)[number]["key"];

export const CTA_TYPES = ["SHOP_NOW", "LEARN_MORE", "BUY_NOW", "ORDER_NOW", "GET_OFFER", "SIGN_UP", "SUBSCRIBE", "SEE_MORE", "CONTACT_US"] as const;
export const CONVERSION_EVENTS = ["PURCHASE", "INITIATED_CHECKOUT", "ADD_TO_CART", "LEAD", "COMPLETE_REGISTRATION"] as const;

/** Meta's recommended lengths; longer copy gets truncated in most placements. */
export const COPY_LIMITS = { primaryText: 125, headline: 40, description: 30, perType: 5 } as const;

export const DEFAULT_URL_TAGS = "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";

export const label = (constant: string) => constant.charAt(0) + constant.slice(1).toLowerCase().replace(/_/g, " ");

type PromotedObject = { custom_event_type?: string; custom_conversion_id?: string } | null | undefined;

const EVENT_ACTIONS: Record<string, [action: string, label: string]> = {
  PURCHASE: ["purchase", "Website purchase"],
  ADD_TO_CART: ["add_to_cart", "Add to cart"],
  INITIATED_CHECKOUT: ["initiate_checkout", "Checkout initiated"],
  ADD_PAYMENT_INFO: ["add_payment_info", "Payment info added"],
  LEAD: ["lead", "Lead"],
  COMPLETE_REGISTRATION: ["complete_registration", "Registration"],
  CONTENT_VIEW: ["view_content", "Content view"],
  SEARCH: ["search", "Search"],
  ADD_TO_WISHLIST: ["add_to_wishlist", "Add to wishlist"],
  SUBSCRIBE: ["subscribe", "Subscription"],
  START_TRIAL: ["start_trial", "Trial started"],
  CONTACT: ["contact", "Contact"],
};

const GOAL_ACTIONS: Record<string, [action: string, label: string]> = {
  LINK_CLICKS: ["link_click", "Link click"],
  LANDING_PAGE_VIEWS: ["landing_page_view", "Landing page view"],
  THRUPLAY: ["video_thruplay", "ThruPlay"],
  POST_ENGAGEMENT: ["post_engagement", "Post engagement"],
  LEAD_GENERATION: ["onsite_conversion.lead_grouped", "Lead (form)"],
  QUALITY_LEAD: ["onsite_conversion.lead_grouped", "Lead (form)"],
  CONVERSATIONS: ["onsite_conversion.messaging_conversation_started_7d", "Conversation started"],
  APP_INSTALLS: ["mobile_app_install", "App install"],
  PAGE_LIKES: ["like", "Page like"],
};

/**
 * What Ads Manager counts as "Results" for an ad set: its conversion event, or the
 * action its optimization goal targets. Purchases when Meta tells us nothing more.
 */
export function resultType(optimizationGoal: string | null | undefined, promotedObject: PromotedObject): { action: string; label: string } {
  if (promotedObject?.custom_conversion_id) {
    return { action: `offsite_conversion.custom.${promotedObject.custom_conversion_id}`, label: "Custom conversion" };
  }
  const event = promotedObject?.custom_event_type && EVENT_ACTIONS[promotedObject.custom_event_type];
  if (event && optimizationGoal !== "LINK_CLICKS" && optimizationGoal !== "LANDING_PAGE_VIEWS") return { action: event[0], label: event[1] };
  const goal = optimizationGoal ? GOAL_ACTIONS[optimizationGoal] : undefined;
  if (goal) return { action: goal[0], label: goal[1] };
  return { action: "purchase", label: "Website purchase" };
}

const BID_STRATEGIES: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Highest volume",
  COST_CAP: "Cost per result goal",
  LOWEST_COST_WITH_BID_CAP: "Bid cap",
  LOWEST_COST_WITH_MIN_ROAS: "ROAS goal",
};

/** Ads Manager's names for bid strategies. */
export function bidStrategyLabel(strategy: string | null | undefined) {
  return strategy ? (BID_STRATEGIES[strategy] ?? label(strategy)) : null;
}

/** "7-day click or 1-day view", as Ads Manager writes an ad set's attribution_spec. */
export function attributionLabel(spec: { event_type: string; window_days: number }[] | null | undefined) {
  if (!spec?.length) return null;
  const parts = spec
    .map((s) => {
      const kind = s.event_type === "CLICK_THROUGH" ? "click" : s.event_type === "VIEW_THROUGH" ? "view" : s.event_type === "ENGAGED_VIDEO_VIEW" ? "engaged view" : null;
      return kind ? { order: kind === "click" ? 0 : kind === "engaged view" ? 1 : 2, text: `${s.window_days}-day ${kind}` } : null;
    })
    .filter((p): p is { order: number; text: string } => p !== null)
    .sort((a, b) => a.order - b.order);
  return parts.length ? parts.map((p) => p.text).join(" or ") : null;
}
