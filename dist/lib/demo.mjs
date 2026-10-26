// Explicit, deterministic September 2026 preview. Never used for configured cloud sessions.
export function createDemoShipments() {
  const statuses = [
    "Delivered",
    "Delivered",
    "In Transit",
    "Delivered",
    "Delivered",
    "Out For Delivery",
    "Delivered",
    "RTO Delivered",
    "Delivered",
    "Undelivered",
    "Delivered",
    "Delivered",
    "In Transit",
    "Delivered",
    "Delivered",
    "RTO Delivered",
    "Delivered",
    "Undelivered",
    "Delivered",
    "Delivered",
    "In Transit",
    "Delivered",
    "Lost",
    "Damaged",
  ];
  const carriers = ["Delhivery", "Blue Dart", "Xpressbees", "DTDC"];
  const places = [
    ["Pune", "Maharashtra"],
    ["Delhi", "Delhi"],
    ["Bengaluru", "Karnataka"],
    ["Mumbai", "Maharashtra"],
    ["Jaipur", "Rajasthan"],
    ["Chennai", "Tamil Nadu"],
  ];
  return Array.from({ length: 192 }, (_, i) => {
    const day = 1 + (i % 23),
      at = (days) =>
        new Date(Date.UTC(2026, 8, day + days, 4, 30)).toISOString();
    const status = statuses[i % statuses.length],
      [city, state] = places[(i * 5) % places.length];
    return {
      id: i + 1,
      shipment_key: `awb:DEMO${10000 + i}`,
      awb: `DEMO${10000 + i}`,
      order_id: `SAMPLE-${1000 + i}`,
      courier: carriers[Math.floor(i / 3) % carriers.length],
      customer: ["Sample Store", "Example Retail", "Demo Commerce"][
        Math.floor(i / 4) % 3
      ],
      recipient: `Sample recipient ${i + 1}`,
      city,
      state,
      pincode: ["411001", "110001", "560001", "400001", "302001", "600001"][
        (i * 5) % 6
      ],
      status,
      order_date: at(0),
      pickup_date: at(1),
      delivered_date: status === "Delivered" ? at(3 + (i % 5)) : null,
      edd: at(5),
      freight: 65 + (i % 100),
      attempts:
        status === "Undelivered" ? 2 : status === "Delivered" ? 1 + (i % 2) : 0,
      product: ["Everyday essentials", "Home collection", "Travel accessories"][
        i % 3
      ],
      sku: `DEMO-SKU-${(i % 3) + 1}`,
      quantity: 1 + (i % 3),
      payment: i % 3 ? "Prepaid" : "COD",
      warehouse: i % 2 ? "Demo Mumbai hub" : "Demo Delhi hub",
      remark:
        status === "Undelivered"
          ? "Demo: recipient unavailable"
          : status === "RTO Delivered"
            ? "Demo: return completed"
            : null,
      source_refs: [],
      updated_at: "2026-09-30T12:00:00Z",
    };
  });
}
