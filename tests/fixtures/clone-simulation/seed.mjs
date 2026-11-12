// Fictional data for the offline clone simulation. None of these people,
// companies, addresses or vehicles exist.

export const PRODUCTION_HOST = "tqoblbwvvvqmwlsfoxni.supabase.co";
export const STAGING_HOST = "enjusebvcfjudrrnvjgl.supabase.co";

export const PEOPLE = {
  jeanneEmail: "jeanne.martin@entreprise-fictive.be",
  jeanneName: "Jeanne Martin",
  jeannePhone: "+32470000001",
  paulEmail: "paul.dupont@exemple-societe.eu",
  paulName: "Paul Dupont",
  customer: "Garage Lambert Namur",
  registration: "1-ABC-123",
  dispatchFile: "Commandes Garage Lambert Namur.xlsx",
};

// Strings that must never reach Staging or a local file.
export const REAL_STRINGS = [
  PEOPLE.jeanneEmail,
  PEOPLE.jeanneName,
  PEOPLE.jeannePhone,
  PEOPLE.paulEmail,
  PEOPLE.paulName,
  PEOPLE.customer,
  PEOPLE.registration,
  "entreprise-fictive",
  "exemple-societe",
  "203.0.113.7",
];

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const COMPOSITION_KEY = "a".repeat(64);
const T = "2026-11-01T08:00:00.000Z";

export const PRODUCTION_IDS = {
  jeanne: U1,
  paul: U2,
  packagingType: "a0000000-0000-4000-8000-000000000001",
  schedule: "a0000000-0000-4000-8000-000000000002",
  batch: "a0000000-0000-4000-8000-000000000003",
  plan: "a0000000-0000-4000-8000-000000000004",
  compositionKey: COMPOSITION_KEY,
};

export function productionSeed() {
  const ids = PRODUCTION_IDS;
  return {
    users: [
      {
        id: U1,
        email: PEOPLE.jeanneEmail,
        phone: PEOPLE.jeannePhone,
        created_at: "2026-01-01T00:00:00Z",
        user_metadata: { full_name: PEOPLE.jeanneName },
        app_metadata: { provider: "email" },
      },
      {
        id: U2,
        email: PEOPLE.paulEmail,
        phone: "",
        created_at: "2026-01-02T00:00:00Z",
        user_metadata: { name: PEOPLE.paulName },
        app_metadata: {},
      },
    ],
    tables: {
      bins: [{ id: "b1", name: "FMC880\t4", min_stock: 2 }],
      accessory_bins: [
        { id: "a1", name: "QR code", current_stock: 10 },
        { id: "a2", name: "Small box", current_stock: 120 },
      ],
      device_thresholds: [{ device: "FMC880", min_stock: 5, updated_at: T }],
      packaging_types: [
        {
          id: ids.packagingType,
          code: "BOX-S",
          name: "Small box",
          category: "BOX",
          on_hand_stock: 120,
          reserved_stock: 0,
          minimum_stock: 10,
          active: true,
          sort_order: 1,
          created_at: T,
          updated_at: T,
          created_by_id: U1,
          created_by_email: PEOPLE.jeanneEmail,
          updated_by_id: U2,
          updated_by_email: PEOPLE.paulEmail,
          legacy_accessory_bin_id: "a2",
        },
      ],
      packaging_rules: [
        {
          id: "pr1",
          trigger_device_id: "b1",
          trigger_packaging_type_id: null,
          packaging_type_id: ids.packagingType,
          quantity: 1,
          max_trigger_count: 2,
          created_at: T,
          updated_at: T,
          updated_by_email: PEOPLE.paulEmail,
        },
      ],
      device_inbound_accessories: [
        { id: "dia1", device_id: "b1", accessory_bin_id: "a1", quantity: 1, created_at: T },
      ],
      alert_subscribers: [{ id: "s1", email: PEOPLE.paulEmail, is_enabled: true }],
      inbound_batches: [{ batch_id: "ib1", actor: PEOPLE.jeanneEmail, vendor: "Teltonika" }],
      boxes: [{ id: "x1", box_code: "BOX-1", bin_id: "b1" }],
      device_accessory_templates: [],
      profiles: [
        { user_id: U1, email: PEOPLE.jeanneEmail, full_name: PEOPLE.jeanneName, current_session_id: "s", last_seen_at: T },
        { user_id: U2, email: PEOPLE.paulEmail, full_name: PEOPLE.paulName, current_session_id: null, last_seen_at: null },
      ],
      user_roles: [
        { user_id: U1, role: "admin" },
        { user_id: U2, role: "operator" },
      ],
      user_permissions: [{ user_id: U1, can_dashboard: true }],
      security_alert_recipients: [
        { user_id: U2, added_by_email: PEOPLE.jeanneEmail, created_at: T },
      ],
      items: [
        { item_id: "i1", imei: "990000000099001", device_id: "b1", box_id: "x1", import_id: "ib1", status: "IN", imported_by: U1 },
      ],
      supplies: [
        { id: "sp1", created_by: PEOPLE.paulEmail, created_by_id: U2, comment: `Pour ${PEOPLE.jeanneName}`, failed_reason: null, tracking_number: "1Z" },
      ],
      supply_items: [],
      supply_status_history: [
        { id: "h1", supply_id: "sp1", changed_by: PEOPLE.jeanneEmail, changed_by_id: U1, failed_reason: null },
      ],
      movements: [
        { movement_id: "m1", type: "RETURN", item_id: "i1", device_id: "b1", imei: "990000000099001", qty: 1, actor: PEOPLE.jeanneEmail, actor_id: U1, created_by: U1, notes: `Remis à ${PEOPLE.paulName}`, shipment_ref: "RET-1", created_at: T },
      ],
      return_records: [
        { id: "r1", movement_id: "m1", item_id: "i1", device_id: "b1", actor: PEOPLE.paulEmail, actor_id: U2, customer: PEOPLE.customer, sur_id: "SUR-1", template_exported_by_email: PEOPLE.jeanneEmail },
      ],
      accessory_movements: [
        { id: "am1", accessory_bin_id: "a1", qty: 3, actor: PEOPLE.paulEmail, actor_id: U2, comment: `${PEOPLE.jeanneEmail} a pris 3` },
      ],
      packaging_stock_movements: [
        { id: "psm1", operation_id: "op1", packaging_type_id: ids.packagingType, movement_type: "CONSUME", on_hand_delta: -1, reason: `Daily dispatch ${PEOPLE.dispatchFile}`, actor_id: U1, actor_email: PEOPLE.jeanneEmail, created_at: T },
        { id: "psm2", operation_id: "op2", packaging_type_id: ids.packagingType, movement_type: "COUNT_ADJUSTMENT", on_hand_delta: 21, reason: "Stock count updated in Packaging Inventory", actor_id: U2, actor_email: PEOPLE.paulEmail, created_at: T },
        { id: "psm3", operation_id: "op3", packaging_type_id: ids.packagingType, movement_type: "ADJUSTMENT", on_hand_delta: -2, reason: `Correction demandée par ${PEOPLE.paulName}`, actor_id: U1, actor_email: PEOPLE.jeanneEmail, created_at: T },
      ],
      nrd_schedules: [
        { id: ids.schedule, user_id: U1, user_email: PEOPLE.jeanneEmail, task: `Réunion avec ${PEOPLE.paulName}`, repeat: "WEEKLY", weekday: 1, start_time: "08:00", end_time: "08:30", created_at: T },
      ],
      nrd_time_logs: [
        { id: "n1", user_id: U1, user_email: PEOPLE.jeanneEmail, task: `Réunion avec ${PEOPLE.paulName}`, schedule_id: ids.schedule, schedule_date: "2026-11-02", auto_stopped: false },
      ],
      dispatch_batches: [
        {
          id: ids.batch,
          operation_id: "op-batch",
          source_sha256: "f".repeat(64),
          source_filename: PEOPLE.dispatchFile,
          status: "CONFIRMED",
          order_ids: ["SO-1"],
          orders: [
            {
              orderId: "SO-1",
              companyName: PEOPLE.customer,
              destinationCountry: "BE",
              compositionKey: COMPOSITION_KEY,
              deviceCounts: { FMC880: 2 },
              items: [{ name: "FMC880", quantity: 2, sourceItem: "FMC880" }],
              packages: [{ packagingTypeId: ids.packagingType, code: "BOX-S", quantity: 1 }],
            },
          ],
          package_usage: [{ code: "BOX-S", name: "Small box", quantity: 1, packagingTypeId: ids.packagingType }],
          order_count: 1,
          line_count: 2,
          total_packages: 1,
          actor_id: U1,
          actor_email: PEOPLE.jeanneEmail,
          confirmed_at: T,
          undone_at: null,
          undone_by_id: null,
          undone_by_email: null,
          created_at: T,
        },
      ],
      dispatch_packaging_preferences: [
        {
          composition_key: COMPOSITION_KEY,
          composition: [{ name: "FMC880", quantity: 2 }],
          packaging_type_id: ids.packagingType,
          package_quantity: 1,
          // Differs from what the trigger rebuilds (1): proves the exact
          // Production row replaced the rebuilt one.
          confirmation_count: 3,
          last_confirmed_batch_id: ids.batch,
          last_actor_email: PEOPLE.jeanneEmail,
          last_confirmed_at: T,
          created_at: T,
          updated_at: T,
          packages: [{ packagingTypeId: ids.packagingType, quantity: 1 }],
        },
      ],
      dispatch_plans: [
        {
          id: ids.plan,
          plan_date: "2026-11-12",
          status: "OPEN",
          planner_id: U1,
          planner_email: PEOPLE.jeanneEmail,
          source_sha256: "e".repeat(64),
          source_filename: PEOPLE.dispatchFile,
          orders: [{ orderId: "SO-1", companyName: PEOPLE.customer, deviceCount: 2 }],
          labels: [{ orderId: "SO-1", deviceModel: "FMC880", registration: PEOPLE.registration }],
          started_at: T,
          created_at: T,
        },
      ],
      dispatch_plan_assignments: [
        { plan_id: ids.plan, order_id: "SO-1", assignee_id: U2, assignee_email: PEOPLE.paulEmail, assigned_by_email: PEOPLE.jeanneEmail, assigned_at: T },
      ],
      audit_events: [
        { audit_id: "ae1", action: "update", entity: "bins", payload: { by: PEOPLE.jeanneEmail }, created_by: U1, created_at: T },
      ],
      alert_log: [
        { id: "al1", device: "FMC880", in_stock: 1, min_stock: 5, sent_to: PEOPLE.paulEmail, sent_at: T },
      ],
      connection_events: [
        { id: "ce1", email: PEOPLE.jeanneEmail, ip_address: "203.0.113.7", user_agent: "Mozilla/5.0" },
      ],
    },
  };
}

// Staging before the run: test accounts and test data in every table,
// linked to each other the way the real Staging is.
export function stagingSeed() {
  const admin = "5a000000-0000-4000-8000-000000000001";
  const picker = "5a000000-0000-4000-8000-000000000002";
  const type = "5b000000-0000-4000-8000-000000000001";
  const batch = "5b000000-0000-4000-8000-000000000002";
  const plan = "5b000000-0000-4000-8000-000000000003";
  const schedule = "5b000000-0000-4000-8000-000000000004";
  return {
    users: [
      { id: admin, email: "admin@stockpro.test", created_at: T, user_metadata: {} },
      { id: picker, email: "picker1@stockpro.test", created_at: T, user_metadata: {} },
    ],
    tables: {
      bins: [{ id: "sb1", name: "FMC880\t4", min_stock: 1 }],
      accessory_bins: [{ id: "sa1", name: "Small box", current_stock: 50 }],
      device_thresholds: [{ device: "FMC880", min_stock: 1, updated_at: T }],
      packaging_types: [
        { id: type, code: "BOX-S", name: "Small box", category: "BOX", on_hand_stock: 50, created_by_id: admin, created_by_email: "admin@stockpro.test", legacy_accessory_bin_id: "sa1" },
      ],
      packaging_rules: [{ id: "spr1", trigger_device_id: "sb1", packaging_type_id: type, quantity: 1 }],
      device_inbound_accessories: [{ id: "sdia1", device_id: "sb1", accessory_bin_id: "sa1", quantity: 1 }],
      packaging_stock_movements: [
        { id: "spsm1", packaging_type_id: type, movement_type: "CONSUME", reason: "Daily dispatch TEST-dispatch-clean.xlsx", actor_id: admin, actor_email: "admin@stockpro.test" },
      ],
      profiles: [
        { user_id: admin, email: "admin@stockpro.test" },
        { user_id: picker, email: "picker1@stockpro.test" },
      ],
      user_roles: [{ user_id: admin, role: "admin" }],
      security_alert_recipients: [{ user_id: admin, added_by_email: "admin@stockpro.test" }],
      nrd_schedules: [{ id: schedule, user_id: admin, user_email: "admin@stockpro.test", task: "Team Meeting" }],
      nrd_time_logs: [{ id: "sn1", user_id: admin, user_email: "admin@stockpro.test", task: "Team Meeting", schedule_id: schedule }],
      dispatch_batches: [
        { id: batch, status: "CONFIRMED", actor_id: admin, actor_email: "admin@stockpro.test", orders: [] },
      ],
      dispatch_packaging_preferences: [
        { composition_key: "b".repeat(64), packaging_type_id: type, last_confirmed_batch_id: batch, last_actor_email: "admin@stockpro.test" },
      ],
      dispatch_plans: [{ id: plan, status: "OPEN", planner_id: admin, planner_email: "admin@stockpro.test", orders: [], labels: [] }],
      dispatch_plan_assignments: [
        { plan_id: plan, order_id: "TEST-1", assignee_id: picker, assignee_email: "picker1@stockpro.test", assigned_by_email: "admin@stockpro.test" },
      ],
      connection_events: [{ id: "sce1", email: "admin@stockpro.test", ip_address: "203.0.113.9", user_agent: "Mozilla" }],
      workload_leases: [{ id: "wl1" }],
    },
  };
}
