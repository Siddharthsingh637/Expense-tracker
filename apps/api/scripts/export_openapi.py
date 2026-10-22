from __future__ import annotations

import json
from pathlib import Path

from expense_tracker_api.main import app

OUTPUT = Path(__file__).resolve().parents[1] / "openapi.json"


def main() -> None:
    OUTPUT.write_text(json.dumps(app.openapi(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote OpenAPI schema to {OUTPUT}")


if __name__ == "__main__":
    main()
