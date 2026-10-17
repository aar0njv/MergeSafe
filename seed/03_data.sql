
SET statement_timeout = 0;
SET lock_timeout = 0;

INSERT INTO users (email, username, status, created_at, updated_at)
SELECT
    'user' || i || '@example.com',
    'user_' || i,
    CASE MOD(i, 3)
        WHEN 0 THEN 'active'
        WHEN 1 THEN 'inactive'
        ELSE        'suspended'
    END,
    NOW() - (random() * INTERVAL '2 years'),
    NOW() - (random() * INTERVAL '1 year')
FROM generate_series(1, 100000) AS s(i);

INSERT INTO products (name, price, stock_quantity, category, created_at)
SELECT
    'Product ' || i,
    ROUND((random() * 499 + 1)::NUMERIC, 2),
    (random() * 1000)::INTEGER,
    CASE MOD(i, 5)
        WHEN 0 THEN 'Electronics'
        WHEN 1 THEN 'Clothing'
        WHEN 2 THEN 'Books'
        WHEN 3 THEN 'Home & Garden'
        ELSE        'Sports'
    END,
    NOW() - (random() * INTERVAL '1 year')
FROM generate_series(1, 10000) AS s(i);

INSERT INTO orders (user_id, product_id, quantity, total_amount, status, created_at)
SELECT
    (MOD(i, 100000) + 1),
    (MOD(i, 10000)  + 1),
    (random() * 9 + 1)::INTEGER,
    ROUND((random() * 999 + 1)::NUMERIC, 2),
    CASE MOD(i, 4)
        WHEN 0 THEN 'pending'
        WHEN 1 THEN 'confirmed'
        WHEN 2 THEN 'shipped'
        ELSE        'cancelled'
    END,
    NOW() - (random() * INTERVAL '1 year')
FROM generate_series(1, 500000) AS s(i);

ANALYZE;