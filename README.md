# KomuniPH Backend

KomuniPH is a community-first social networking platform designed for the
Philippines, built with an architecture that supports future international
expansion. This repository contains the **backend foundation** — the
shared infrastructure that every future feature module (Authentication,
Profile, Feed, Messenger, Marketplace, Wallet, Communities, Live) will be
built on top of.

This foundation intentionally implements **no product features**. It
provides configuration, database access, logging, middleware, error
handling, and reusable security primitives only.

## Architecture

- **Clean Architecture** — business logic is isolated from the API layer.
- **Feature-First** — each future product feature lives in its own
  self-contained module under `app/modules/<feature_name>`, with its own
  models, schemas, repositories, services, and routes.
- **SOLID principles** throughout.

## Tech Stack

| Concern        | Technology              |
|----------------|--------------------------|
| Language       | Python 3.12+             |
| Web framework  | FastAPI                  |
| ORM            | SQLAlchemy 2.x (async)   |
| Migrations     | Alembic                  |
| Database       | PostgreSQL               |
| Cache / limits | Redis                    |
| Validation     | Pydantic v2               |
| Password hashing | Argon2id (argon2-cffi) |

## Project Structure

```
backend/
    app/
        main.py            # Application factory / ASGI entrypoint
        config.py           # Typed settings (Pydantic Settings)
        dependencies.py     # Shared FastAPI dependencies
        logging.py           # Centralized logging configuration
        exceptions.py        # Exception hierarchy + global handlers
        lifespan.py          # Startup / shutdown lifecycle
        core/
            constants.py      # App-wide constants
            security.py        # Password hashing, JWT, permissions
        database/
            base.py            # Declarative base + shared mixins
            session.py         # Async engine/session + DI
            migrations/         # Alembic environment
        middleware/
            cors.py
            logging.py
            request_id.py
            rate_limit.py
        api/
            router.py           # Aggregate API router
            health.py            # GET /health
        utils/                    # Generic, stateless helpers
        modules/                  # Feature modules (empty for now)
        tests/                     # Foundation-level tests
requirements.txt
pyproject.toml
.env.example
Dockerfile
docker-compose.yml
alembic.ini
```

## Getting Started

### 1. Prerequisites

- Python 3.12+
- Docker & Docker Compose (recommended for local Postgres/Redis)

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env and set a real SECRET_KEY:
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 3. Run with Docker Compose (recommended)

```bash
docker compose up --build
```

This starts the API on `http://localhost:8000`, PostgreSQL, and Redis.

### 4. Run locally without Docker

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Ensure PostgreSQL and Redis are running and reachable per your .env

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 5. Verify the service is healthy

```bash
curl http://localhost:8000/health
```

Expected response:

```json
{
    "status": "healthy",
    "application": "KomuniPH",
    "version": "1.0.0"
}
```

## Database Migrations

Alembic is fully wired to the application's settings and shared
declarative base (`app/database/base.py`). No feature-module models exist
yet, so there is nothing to migrate — but the workflow is ready:

```bash
# Generate a new migration after adding models to a feature module
alembic revision --autogenerate -m "add <feature> tables"

# Apply migrations
alembic upgrade head

# Roll back one migration
alembic downgrade -1
```

## Testing

```bash
pytest
```

## Code Quality

```bash
ruff check .
ruff format .
mypy app
```

## Adding a New Feature Module

1. Create `app/modules/<feature_name>/` with `models.py`, `schemas.py`,
   `repository.py`, `service.py`, and `api/routes.py`.
2. Have models inherit from `app.database.base.Base` (and the provided
   mixins where relevant). Nothing else needs to import `models.py`
   manually — `app.database.model_registry.discover_and_import_models`
   finds and imports it automatically by convention (any
   `app/modules/<feature>/models.py`) both at application startup and
   before Alembic autogenerate runs.
3. Register the module's router in `app/api/router.py`.
4. Run `alembic revision --autogenerate` to generate its migration.
5. Services own transaction boundaries: routes/services must call
   `await session.commit()` explicitly once their unit of work succeeds —
   `get_db_session` opens, yields, rolls back on error, and closes the
   session, but never commits automatically.

## Notes on Scope

This foundation deliberately excludes Authentication, Profile, Feed,
Messenger, Marketplace, Wallet, Communities, and Live. Reusable security
primitives (password hashing, JWT encode/decode, permission checking) are
provided in `app/core/security.py` for those modules to build on, but no
authentication flow is implemented here.
