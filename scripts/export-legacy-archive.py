import asyncio
import json
import os
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine


TABLES = [
    "recommendation_embeddings",
    "user_recommendations",
    "recommendation_signals",
    "replication_outbox",
    "replication_inbound_ledger",
    "oauth_client_registrations",
    "release_flags",
    "release_promotion_audit",
    "id_migration_map",
]


def json_default(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (UUID, Decimal)):
        return str(value)
    if isinstance(value, bytes):
        return value.hex()
    raise TypeError(f"Unsupported archive value: {type(value)!r}")


async def main():
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("Set DATABASE_URL to the original Wyvern PostgreSQL database")
    if database_url.startswith("postgresql://"):
        database_url = database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    elif database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql+asyncpg://", 1)

    engine = create_async_engine(database_url)
    try:
        async with engine.connect() as connection:
            identity = (
                await connection.execute(
                    text(
                        "SELECT current_database() AS database, "
                        "current_setting('server_version') AS server_version, "
                        "current_schema() AS schema"
                    )
                )
            ).mappings().one()
            existing = set(await connection.run_sync(lambda sync_connection: inspect(sync_connection).get_table_names()))
            tables = {}
            for table_name in TABLES:
                rows = []
                if table_name in existing:
                    result = await connection.execute(text(f'SELECT * FROM "{table_name}" ORDER BY 1'))
                    rows = [dict(row) for row in result.mappings().all()]
                tables[table_name] = {"exists": table_name in existing, "rows": rows}
        print(json.dumps({"database": dict(identity), "tables": tables}, default=json_default))
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
