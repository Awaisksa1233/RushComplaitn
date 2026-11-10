"""Read-only inspection of the LOCAL funnel database (rush_funnel): which collections exist and which fields
funnel_messages / funnel_events carry. Used to confirm that template performance can be attributed per recipient.

Local MongoDB only (127.0.0.1). Never connects to Atlas. Prints field names, types and counts; values of
contact fields are masked.
"""
import sys
from collections import Counter

from pymongo import MongoClient

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

LOCAL_URIS = ["mongodb://127.0.0.1:27017", "mongodb://127.0.0.1:27018"]
DB_NAME = "rush_funnel"
SAMPLE = 500
MASK = ("phone", "contact", "name", "to", "recipient")


def show(value, key):
    if any(m in key.lower() for m in MASK) and isinstance(value, str):
        return f"<masked str len={len(value)} prefix={value[:4]!r}>"
    text = repr(value)
    return text if len(text) <= 80 else text[:77] + "..."


def describe(col):
    total = col.estimated_document_count()
    print(f"\n== {col.name}: {total} documents")
    fields = Counter()
    types = {}
    example = {}
    for doc in col.find({}).sort("_id", -1).limit(SAMPLE):
        for k, v in doc.items():
            fields[k] += 1
            types.setdefault(k, set()).add(type(v).__name__)
            example.setdefault(k, v)
    for k, n in fields.most_common():
        print(f"   {k:<22} in {n:>4} of sample  types={sorted(types[k])}  e.g. {show(example[k], k)}")
    return fields


def main():
    for uri in LOCAL_URIS:
        client = MongoClient(uri, serverSelectionTimeoutMS=2500)
        try:
            names = client.list_database_names()
        except Exception as err:  # noqa: BLE001
            print(f"{uri}: not reachable ({type(err).__name__})")
            continue
        print(f"{uri}: databases = {names}")
        if DB_NAME not in names:
            print(f"   '{DB_NAME}' is not on this server")
            continue
        db = client[DB_NAME]
        cols = sorted(db.list_collection_names())
        print(f"   collections = {cols}")
        for name in cols:
            fields = describe(db[name])
            if name == "funnel_messages":
                for key in ("status", "templateId", "flowId", "stepId", "variant", "variantKey"):
                    if key in fields:
                        top = Counter(d.get(key) for d in db[name].find({}, {key: 1}))
                        print(f"   -> {key} values: {dict(top.most_common(40))}")
            if name == "funnel_events" and "stageId" in fields:
                top = Counter(d.get("stageId") for d in db[name].find({}, {"stageId": 1}))
                print(f"   -> stageId values: {dict(top.most_common(40))}")


if __name__ == "__main__":
    main()
