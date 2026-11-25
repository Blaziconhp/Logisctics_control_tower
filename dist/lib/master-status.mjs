// Status Mapper SHARV.xlsx, columns A:B. Raw status remains available separately.
const groups = {
  Cancelled: ['CANCELED', 'CANCELLATION REQUESTED'],
  Delivered: ['DELIVERED'],
  Intransit: ['PICKED UP', 'SHIPPED', 'IN TRANSIT', 'IN TRANSIT-EN-ROUTE', 'REACHED DESTINATION HUB', 'IN TRANSIT-AT DESTINATION HUB'],
  'Pickup Pending': ['PICKUP EXCEPTION', 'PICKUP RESCHEDULED', 'PICKUP SCHEDULED', 'OUT FOR PICKUP'],
  Lost: ['UNTRACEABLE', 'LOST'],
  Misrouted: ['MISROUTED'],
  NA: [''],
  OFD: ['OUT FOR DELIVERY'],
  'New Order': ['NEW ORDER'],
  'RTO Delivered': ['RTO Delivered'],
  'RTO Intransit': ['RTO INITIATED', 'RTO IN TRANSIT', 'REACHED BACK AT_SELLER_CITY'],
  'RTO OFD': ['RTO OFD'],
  'RTO Undelivered': ['RTO Undelivered', 'RTO NDR'],
  Undelivered: ['UNDELIVERED-1st Attempt', 'UNDELIVERED-2nd Attempt', 'UNDELIVERED-3rd Attempt', 'UNDELIVERED'],
};
const key = (s) => String(s ?? '').trim().toUpperCase();
const mapping = new Map(Object.entries(groups).flatMap(([master, statuses]) => statuses.map(s => [key(s), master])));
export const masterStatus = (status) => mapping.get(key(status)) ?? String(status ?? '').trim();
export const effectiveStatus = (r) => r.master_status ?? masterStatus(r.source_status ?? r.details?.source_status ?? r.status);
export const pickupPending = (r) => effectiveStatus(r).toLowerCase() === 'pickup pending';
export function orderAmount(r) {
  const explicit = r.order_amount ?? r.details?.order_amount;
  const values = explicit == null ? (r.lines || r.details?.lines || []).flatMap(line => Object.entries(line.raw || {}).filter(([k]) => ['order amount', 'order value', 'order total', 'total order value'].includes(k.toLowerCase().replace(/[_\s]+/g, ' ').trim())).map(([,v]) => v)) : [explicit];
  for (const value of values) {
    if (value == null || String(value).trim() === '') continue;
    const amount = Number(String(value).replace(/[,₹\s]/g, ''));
    if (Number.isFinite(amount)) return amount;
  }
  return null;
}
