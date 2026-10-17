SET client_min_messages TO WARNING;

CREATE TABLE IF NOT EXISTS users (
    id          BIGSERIAL       PRIMARY KEY,
    email       VARCHAR(255)    NOT NULL UNIQUE,
    username    VARCHAR(100)    NOT NULL,
    status      VARCHAR(20)     NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
    id              BIGSERIAL       PRIMARY KEY,
    name            VARCHAR(255)    NOT NULL,
    price           NUMERIC(10,2)   NOT NULL,
    stock_quantity  INTEGER         NOT NULL DEFAULT 0,
    category        VARCHAR(100)    NOT NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id            BIGSERIAL       PRIMARY KEY,
    user_id       BIGINT          NOT NULL REFERENCES users(id),
    product_id    BIGINT          NOT NULL REFERENCES products(id),
    quantity      INTEGER         NOT NULL DEFAULT 1,
    total_amount  NUMERIC(10,2)   NOT NULL,
    status        VARCHAR(20)     NOT NULL DEFAULT 'pending',
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);