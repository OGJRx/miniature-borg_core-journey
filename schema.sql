DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS jobs;

CREATE TABLE users (
    telegram_id INTEGER PRIMARY KEY,
    first_name TEXT,
    username TEXT,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, -- Relación con telegram_id
    vehicle_info TEXT,
    status TEXT DEFAULT 'PENDING', -- PENDING, IN_PROGRESS, DONE
    notes TEXT,
    progress INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY(user_id) REFERENCES users(telegram_id)
);

-- Índices para velocidad de lectura extrema
CREATE INDEX idx_jobs_user ON jobs(user_id);
