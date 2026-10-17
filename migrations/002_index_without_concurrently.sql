-- Intentionally create an index without using CONCURRENTLY to simulate locking behavior
-- This will block long-running queries and fail CI on large tables

CREATE INDEX idx_orders_total_amount ON orders(total_amount);