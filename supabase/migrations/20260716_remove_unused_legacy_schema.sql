begin;

-- These legacy functions are not called by the application, attached to a
-- trigger, exposed through Realtime, or scheduled by pg_cron in staging.
drop function if exists public.cleanup_movements();
drop function if exists public.dashboard_stock_by_device_in(uuid);
drop function if exists public.dashboard_stock_by_location_in(uuid);
drop function if exists public.delete_adjust_for_empty_boxes();
drop function if exists public.delete_empty_boxes();
drop function if exists public.full_cleanup_empty_boxes();
drop function if exists public.get_inbound_batch_stats();
drop function if exists public.inbound_batch_import(jsonb, text, uuid, text);
drop function if exists public.movements_operation_default();
drop function if exists public.movements_operation_trigger();
drop function if exists public.prevent_negative_stock();
drop function if exists public.recent_activity();
drop function if exists public.stock_out_box(uuid, text);
drop function if exists public.stock_out_box(uuid, uuid);
drop function if exists public.update_device_stock();

-- The application uses the newer dashboard_* views listed in the companion
-- test. These duplicate or devices-based legacy views have no code callers.
drop view if exists public.dashboard_activity_view;
drop view if exists public.dashboard_analytics;
drop view if exists public.dashboard_device_flow_view;
drop view if exists public.dashboard_devices;
drop view if exists public.dashboard_recent_activity_view;
drop view if exists public.dashboard_sales;
drop view if exists public.dashboard_sales_chart;
drop view if exists public.dashboard_sales_chart_view;
drop view if exists public.dashboard_stock_view;
drop view if exists public.dashboard_summary;
drop view if exists public.dashboard_top_device;
drop view if exists public.monthly_sales_dashboard_view;
drop view if exists public.stock_by_device;

-- All of these tables were empty during the staging audit and have no
-- application, view, trigger, Realtime, or scheduled-job consumers.
-- Child tables are removed before their referenced parent tables.
drop table if exists public.stock_count_scans;
drop table if exists public.stock_counts;
drop table if exists public.inbound_import_boxes;
drop table if exists public.inbound_import_log_boxes;
drop table if exists public.inbound_imports_log;
drop table if exists public.inbound_import_logs;
drop table if exists public.inbound_imports;
drop table if exists public.device_aliases;
drop table if exists public.box_movements;
drop table if exists public.device_stock;
drop table if exists public.imeis;
drop table if exists public.import_batches;
drop table if exists public.outbound_batches;

commit;
