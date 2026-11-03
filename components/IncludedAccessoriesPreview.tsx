"use client";

import { accessoryNameParts } from "@/lib/accessory-outbound-preview";
import type { IncludedAccessoryLine } from "@/lib/inbound-accessories";

// Accessories added with the received devices (Inventory Setup > Included at
// inbound). Untick a line when that accessory was not delivered this time.
export default function IncludedAccessoriesPreview({
  lines,
  skipped,
  onToggle,
  deviceName,
}: {
  lines: IncludedAccessoryLine[];
  skipped: string[];
  onToggle: (ruleId: string) => void;
  deviceName: (deviceId: string) => string | undefined;
}) {
  if (lines.length === 0) return null;

  return (
    <div className="included-accessories">
      <strong>Accessories included with these devices</strong>
      <p>Added to accessory stock on confirmation. Untick an accessory that was not delivered.</p>
      <ul>
        {lines.map((line) => {
          const [name] = accessoryNameParts(line.accessory);
          const included = !skipped.includes(line.ruleId);
          return (
            <li key={line.ruleId} className={included ? "" : "is-skipped"}>
              <label>
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => onToggle(line.ruleId)}
                  aria-label={`Add ${line.qty} ${name}`}
                />
                <span>
                  <b>{`+${line.qty} × ${name}`}</b>
                  <small>{`${line.perDevice} per device · ${line.devices} new ${deviceName(line.deviceId) || "devices"}`}</small>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
