"""
Tests for services/qb_activity_timeline_queries.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP = ROOT / "desktop-app"
if str(DESKTOP_APP) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP))

from services.qb_activity_timeline_queries import (
    query_sales_receipts,
    query_invoices,
    query_payments,
    query_deposits,
    query_journal_entries,
    query_bills,
    query_checks,
    query_all_for_date,
)

from services.qb_activity_timeline_service import (
    _sort_key,
    _dedupe_events,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mock_client(*, query_results: dict[str, tuple[list, str | None]]):
    """Return a mock QBClient that returns configured responses."""
    mock = MagicMock()
    def fake_send(qbxml: str) -> str:
        import xml.etree.ElementTree as ET
        root = ET.fromstring(qbxml)
        rq_tag = root.find(".//{http://www.intuit.com/ipp/fms}SalesReceiptQueryRq")
        # Find which query was called
        for tag, (elements, error) in query_results.items():
            if error:
                status_code = "3250"
                status_msg = error
            else:
                status_code = "0"
                status_msg = "OK"
            rs_tag = tag.replace("QueryRq", "QueryRs")
            ret_tag = tag.replace("QueryRq", "Ret")
            # Build a fake response
            ret_elements = ""
            for el_data in elements:
                ret_elements += f"<{ret_tag}><TxnID>{el_data.get('txn_id','')}</TxnID><TxnDate>{el_data.get('txn_date','')}</TxnDate></{ret_tag}>"
            return f"""<?xml version="1.0"?>
<QBXML><QBXMLMsgsRs><{rs_tag} statusCode="{status_code}" statusMessage="{status_msg}">{ret_elements}</{rs_tag}></QBXMLMsgsRs></QBXML>"""
        return """<?xml version="1.0"?><QBXML><QBXMLMsgsRs></QBXMLMsgsRs></QBXML>"""

    mock._send = fake_send
    return mock


# ── Dedup ──────────────────────────────────────────────────────────────────────

def test_dedupe_removes_duplicate_txn_ids():
    events = [
        {"txn_id": "TXN-1", "txn_type": "sales_receipt"},
        {"txn_id": "TXN-2", "txn_type": "invoice"},
        {"txn_id": "TXN-1", "txn_type": "sales_receipt"},  # duplicate
        {"txn_id": "TXN-3", "txn_type": "payment"},
    ]
    result = _dedupe_events(events)
    assert len(result) == 3
    ids = [e["txn_id"] for e in result]
    assert ids == ["TXN-1", "TXN-2", "TXN-3"]


def test_dedupe_keeps_null_txn_id():
    events = [
        {"txn_id": None, "txn_type": "sales_receipt"},
        {"txn_id": None, "txn_type": "sales_receipt"},
    ]
    result = _dedupe_events(events)
    assert len(result) == 2  # null ids are not deduplicated


# ── Sort ───────────────────────────────────────────────────────────────────────

def test_sort_key_prefers_time_modified():
    ev1 = {"time_modified": "2026-06-03T10:00:00", "time_created": "2026-06-03T09:00:00", "txn_date": "2026-06-03"}
    ev2 = {"time_modified": "2026-06-03T11:00:00", "time_created": "2026-06-03T09:00:00", "txn_date": "2026-06-03"}
    assert _sort_key(ev2) > _sort_key(ev1)


def test_sort_key_falls_back_to_time_created():
    ev1 = {"time_created": "2026-06-03T09:00:00", "txn_date": "2026-06-03"}
    ev2 = {"time_created": "2026-06-03T11:00:00", "txn_date": "2026-06-03"}
    assert _sort_key(ev2) > _sort_key(ev1)


def test_sort_key_falls_back_to_txn_date():
    ev1 = {"txn_date": "2026-06-01"}
    ev2 = {"txn_date": "2026-06-03"}
    assert _sort_key(ev2) > _sort_key(ev1)


# ── query_all_for_date ─────────────────────────────────────────────────────────

def test_query_all_for_date_returns_empty_on_qb_error():
    mock = MagicMock()
    mock._send.side_effect = RuntimeError("QB not available")
    events, warnings, errors = query_all_for_date(mock, "2026-06-03")
    assert events == []
    assert "sales_receipt" in errors[0] if errors else True


def test_query_all_for_date_empty_results_gives_warning():
    mock = MagicMock()
    # Simulate empty response
    mock._send.return_value = """<?xml version="1.0"?>
<QBXML><QBXMLMsgsRs>
<SalesReceiptQueryRs statusCode="1" statusMessage="No records"/>
</QBXMLMsgsRs></QBXML>"""
    events, warnings, errors = query_all_for_date(mock, "2026-06-03", include_types=["sales_receipt"])
    assert events == []
    assert any("No sales_receipt" in w for w in warnings)


def test_query_all_for_date_skips_disabled_types():
    mock = MagicMock()
    mock._send.return_value = """<?xml version="1.0"?>
<QBXML><QBXMLMsgsRs><SalesReceiptQueryRs statusCode="1"/></QBXMLMsgsRs></QBXML>"""
    events, warnings, errors = query_all_for_date(
        mock, "2026-06-03",
        include_types=["invoice"],  # no sales_receipt
    )
    assert events == []
    assert all("sales_receipt" not in w for w in warnings)


def test_bank_account_filter_uses_qbxml_account_filter():
    from services import qb_activity_timeline_queries as queries
    assert queries._account_filter_xml("Chase Checking") == (
        "<AccountFilter><FullName>Chase Checking</FullName></AccountFilter>"
    )


# ── XML parsing ────────────────────────────────────────────────────────────────

def test_parse_all_ret_error_code():
    from services.qb_activity_timeline_queries import _parse_all_ret
    xml = """<?xml version="1.0"?>
<QBXML><QBXMLMsgsRs><SalesReceiptQueryRs statusCode="3250" statusMessage="Invalid"/></QBXMLMsgsRs></QBXML>"""
    elements, error = _parse_all_ret(xml, "SalesReceiptQueryRs", "SalesReceiptRet")
    assert elements == []
    assert error is not None
    assert "3250" in error


def test_parse_all_ret_status_1_no_records():
    from services.qb_activity_timeline_queries import _parse_all_ret
    xml = """<?xml version="1.0"?>
<QBXML><QBXMLMsgsRs><SalesReceiptQueryRs statusCode="1"/></QBXMLMsgsRs></QBXML>"""
    elements, error = _parse_all_ret(xml, "SalesReceiptQueryRs", "SalesReceiptRet")
    assert elements == []
    assert error is None  # No records is not an error


def test_parse_all_ret_success():
    from services.qb_activity_timeline_queries import _parse_all_ret
    xml = """<?xml version="1.0"?>
<QBXML><QBXMLMsgsRs>
<InvoiceQueryRs statusCode="0">
<InvoiceRet><TxnID>INV-1</TxnID><TxnDate>2026-06-03</TxnDate></InvoiceRet>
</InvoiceQueryRs>
</QBXMLMsgsRs></QBXML>"""
    elements, error = _parse_all_ret(xml, "InvoiceQueryRs", "InvoiceRet")
    assert error is None
    assert len(elements) == 1
    assert elements[0].findtext("TxnID") == "INV-1"
