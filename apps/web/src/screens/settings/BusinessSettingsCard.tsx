import type { Dispatch, SetStateAction } from "react";
import { gstinProblem } from "@pos/contracts";
import { uploadSrc } from "../../lib/api";
import type { BusinessSettingsForm } from "./settingsForms";
import type { BusinessSettingsMutations } from "./useBusinessSettingsMutations";

/** Every IANA zone this browser knows, keeping the saved one even if it isn't listed. */
function timeZoneOptions(current: string) {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Asia/Kolkata", "UTC"];
  return supported.includes(current) ? supported : [current, ...supported];
}

/** Settings shared by every branch: name, GST number, tax, discount and return rules, scale labels and the logo. */
export function BusinessSettingsCard({
  businessForm,
  setBusinessForm,
  businessSettings,
  saveBusinessSettings,
  uploadBusinessLogoMutation,
  businessMessage,
}: {
  businessForm: BusinessSettingsForm;
  setBusinessForm: Dispatch<SetStateAction<BusinessSettingsForm>>;
  businessSettings: { isLoading: boolean };
  saveBusinessSettings: BusinessSettingsMutations["saveBusinessSettings"];
  uploadBusinessLogoMutation: BusinessSettingsMutations["uploadBusinessLogoMutation"];
  businessMessage: string;
}) {
  const businessLogoSrc = uploadSrc(businessForm.logoUrl);

  return (
    <div className="card p-5">
      <h2 className="text-lg font-semibold tracking-tight text-slate-900">Business Settings</h2>
      <p className="mt-1 text-sm text-slate-600">
        Configure global details shared by all branches, including logo and GST number.
      </p>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-600">Business name</label>
            <input
              className="field mt-1"
              value={businessForm.name}
              onChange={(e) => setBusinessForm((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm text-slate-600">GST number</label>
            <input
              className="field mt-1"
              value={businessForm.gstNumber}
              onChange={(e) => setBusinessForm((prev) => ({ ...prev, gstNumber: e.target.value.toUpperCase() }))}
              placeholder="e.g. 29ABCDE1234F1ZW"
            />
            {businessForm.gstNumber.trim() && gstinProblem(businessForm.gstNumber.trim()) ? (
              <p className="mt-1 text-xs text-rose-700">{gstinProblem(businessForm.gstNumber.trim())}</p>
            ) : null}
          </div>
          <div>
            <label className="text-sm text-slate-600">Tax calculation mode</label>
            <select
              className="field mt-1"
              value={businessForm.taxCalculationMode}
              onChange={(e) =>
                setBusinessForm((prev) => ({
                  ...prev,
                  taxCalculationMode: e.target.value as "AFTER_DISCOUNT" | "BEFORE_DISCOUNT",
                }))
              }
            >
              <option value="AFTER_DISCOUNT">After discount</option>
              <option value="BEFORE_DISCOUNT">Before discount</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Controls whether tax is recomputed after discounts or held on the original pre-discount base.
            </p>
          </div>
          <div>
            <label className="text-sm text-slate-600">Cashier discount limit (%)</label>
            <input
              className="field mt-1"
              inputMode="decimal"
              value={businessForm.cashierMaxDiscountPercent}
              onChange={(e) =>
                setBusinessForm((prev) => ({ ...prev, cashierMaxDiscountPercent: e.target.value }))
              }
            />
            <p className="mt-1 text-xs text-slate-500">
              The most a cashier can take off a sale's list price, counting price changes and discounts together.
              Admins have no limit.
            </p>
          </div>
          <div>
            <label className="text-sm text-slate-600">Round off bill totals</label>
            <select
              className="field mt-1"
              value={businessForm.roundOffMode}
              onChange={(e) =>
                setBusinessForm((prev) => ({ ...prev, roundOffMode: e.target.value as "NONE" | "NEAREST_1" | "NEAREST_050" }))
              }
            >
              <option value="NONE">Don't round</option>
              <option value="NEAREST_1">To the nearest ₹1</option>
              <option value="NEAREST_050">To the nearest 50 paise</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              The bill shows a round-off line; item prices, taxable values and GST are not changed.
            </p>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={businessForm.allowNegativeStock}
                onChange={(e) => setBusinessForm((prev) => ({ ...prev, allowNegativeStock: e.target.checked }))}
              />
              Allow selling past the stock count
            </label>
            <p className="mt-1 text-xs text-slate-500">
              For when the count is wrong but the goods are on the counter. Admins can then sell past it, and
              cashiers given "Sell past stock". Stock goes below zero until it is counted (Stock shows which items).
            </p>
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={businessForm.scaleEnabled}
                onChange={(e) => setBusinessForm((prev) => ({ ...prev, scaleEnabled: e.target.checked }))}
              />
              Weighing scale labels
            </label>
            <p className="mt-1 text-xs text-slate-500">
              How the scale prints its barcode: a prefix, the item's code (its PLU, the same as the item code here), the
              weight or price, and a check digit. For example 2 · 001234 · 01250 · check, read as item 1234, 1.250 kg.
            </p>
            {businessForm.scaleEnabled ? (
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
                <label className="text-xs text-slate-600">
                  Prefix
                  <input className="field mt-1" inputMode="numeric" value={businessForm.scalePrefix}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, scalePrefix: e.target.value }))} />
                </label>
                <label className="text-xs text-slate-600">
                  Item code digits
                  <input className="field mt-1" inputMode="numeric" value={businessForm.scaleItemDigits}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, scaleItemDigits: e.target.value }))} />
                </label>
                <label className="text-xs text-slate-600">
                  The label carries
                  <select className="field mt-1" value={businessForm.scaleValueType}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, scaleValueType: e.target.value as "WEIGHT" | "PRICE", scaleValueDecimals: e.target.value === "PRICE" ? "2" : "3" }))}>
                    <option value="WEIGHT">Weight</option>
                    <option value="PRICE">Price</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  Its digits
                  <input className="field mt-1" inputMode="numeric" value={businessForm.scaleValueDigits}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, scaleValueDigits: e.target.value }))} />
                </label>
                <label className="text-xs text-slate-600">
                  Decimal places
                  <input className="field mt-1" inputMode="numeric" value={businessForm.scaleValueDecimals}
                    onChange={(e) => setBusinessForm((prev) => ({ ...prev, scaleValueDecimals: e.target.value }))} />
                </label>
              </div>
            ) : null}
          </div>
          <div>
            <label className="text-sm text-slate-600">Return window for cashiers (days)</label>
            <input
              className="field mt-1"
              inputMode="numeric"
              placeholder="No limit"
              value={businessForm.returnWindowDays}
              onChange={(e) => setBusinessForm((prev) => ({ ...prev, returnWindowDays: e.target.value }))}
            />
            <p className="mt-1 text-xs text-slate-500">
              How many days after a sale a cashier can still take its goods back (0: the same day only). Empty for no
              limit. Admins can always make a return.
            </p>
          </div>
          <div>
            <label className="text-sm text-slate-600">Customers</label>
            <select
              className="field mt-1"
              value={businessForm.customerScope}
              onChange={(e) =>
                setBusinessForm((prev) => ({ ...prev, customerScope: e.target.value as "SHARED" | "BRANCH" }))
              }
            >
              <option value="SHARED">Shared across all branches</option>
              <option value="BRANCH">Separate for each branch</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Shared: a customer and their wallet balance can be used at any branch, and a phone number belongs to one
              customer business-wide. Separate: each branch only sees the customers it created.
            </p>
          </div>
          <div>
            <label className="text-sm text-slate-600">Time zone</label>
            <select
              className="field mt-1"
              value={businessForm.timezone}
              onChange={(e) => setBusinessForm((prev) => ({ ...prev, timezone: e.target.value }))}
            >
              {timeZoneOptions(businessForm.timezone).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Reports work out Today, This Week and This Month on this clock.
            </p>
          </div>
          <div>
            <label className="text-sm text-slate-600">HSN code length</label>
            <select
              className="field mt-1"
              value={businessForm.hsnMinDigits}
              onChange={(e) =>
                setBusinessForm((prev) => ({ ...prev, hsnMinDigits: Number(e.target.value) === 6 ? 6 : 4 }))
              }
            >
              <option value={4}>At least 4 digits (turnover up to ₹5 crore)</option>
              <option value={6}>At least 6 digits (turnover above ₹5 crore)</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">
              The shortest HSN or SAC code accepted on items, set by last year's turnover.
            </p>
          </div>
        </div>

        <div>
          <label className="text-sm text-slate-600">Global logo</label>
          <div className="mt-2 flex items-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded border border-slate-200 bg-slate-50">
              {businessLogoSrc ? <img src={businessLogoSrc} alt="Business logo" className="h-full w-full object-contain" /> : null}
            </div>
            <div className="grid gap-2">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadBusinessLogoMutation.mutate(file);
                }}
              />
              <button
                className="btn-secondary px-2 py-1 text-xs"
                onClick={() => setBusinessForm((prev) => ({ ...prev, logoUrl: null }))}
              >
                Remove logo
              </button>
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Branch logo can override this. If branch logo is empty, this one is used.
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={() => saveBusinessSettings.mutate()}
          disabled={saveBusinessSettings.isPending || businessSettings.isLoading}
        >
          Save Business Settings
        </button>
        {businessMessage ? <p className="text-sm text-emerald-700">{businessMessage}</p> : null}
      </div>
    </div>
  );
}
