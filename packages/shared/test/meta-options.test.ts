import { describe, expect, it } from "vitest";
import { attributionLabel, bidStrategyLabel, resultType } from "../src/meta-options";

describe("Ads Manager labels", () => {
  it("results follow the ad set's conversion event", () => {
    expect(resultType("OFFSITE_CONVERSIONS", { custom_event_type: "PURCHASE" })).toEqual({ action: "purchase", label: "Website purchase" });
    expect(resultType("OFFSITE_CONVERSIONS", { custom_event_type: "ADD_TO_CART" }).action).toBe("add_to_cart");
    expect(resultType("OFFSITE_CONVERSIONS", { custom_conversion_id: "123" }).action).toBe("offsite_conversion.custom.123");
    expect(resultType("LANDING_PAGE_VIEWS", { custom_event_type: "PURCHASE" }).action).toBe("landing_page_view");
    expect(resultType(null, null).action).toBe("purchase");
  });

  it("names bid strategies and attribution like Ads Manager", () => {
    expect(bidStrategyLabel("LOWEST_COST_WITHOUT_CAP")).toBe("Highest volume");
    expect(bidStrategyLabel("COST_CAP")).toBe("Cost per result goal");
    expect(attributionLabel([{ event_type: "VIEW_THROUGH", window_days: 1 }, { event_type: "CLICK_THROUGH", window_days: 7 }])).toBe("7-day click or 1-day view");
    expect(attributionLabel([{ event_type: "CLICK_THROUGH", window_days: 7 }])).toBe("7-day click");
    expect(attributionLabel([])).toBeNull();
  });
});
