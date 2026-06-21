"""
Tests for services/qb_activity_queries.py

All QB COM calls are mocked — tests run without QuickBooks installed.
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


# ── XML fixture helpers ───────────────────────────────────────────────────────

def _sr_xml(txn_date="2026-06-02", ref="12345", amount="120.50",
             customer="Toast Sales - Bandera", class_name="Bandera") -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRs>
    <SalesReceiptQueryRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">
      <SalesReceiptRet>
        <TxnID>ABC123</TxnID>
        <TxnDate>{txn_date}</TxnDate>
        <RefNumber>{ref}</RefNumber>
        <TotalAmount>{amount}</TotalAmount>
        <CustomerRef><FullName>{customer}</FullName></CustomerRef>
        <ClassRef><FullName>{class_name}</FullName></ClassRef>
        <Memo>Daily Sales</Memo>
      </SalesReceiptRet>
    </SalesReceiptQueryRs>
  </QBXMLMsgsRs>
</QBXML>"""


def _empty_xml(rs_tag="SalesReceiptQueryRs") -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRs>
    <{rs_tag} statusCode="1" statusSeverity="Info" statusMessage="Status OK">
    </{rs_tag}>
  </QBXMLMsgsRs>
</QBXML>"""


def _check_xml(txn_date="2026-06-01", cleared="Reconciled", amount="5000.00") -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRs>
    <CheckQueryRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">
      <CheckRet>
        <TxnID>CHK001</TxnID>
        <TxnDate>{txn_date}</TxnDate>
        <Amount>{amount}</Amount>
        <ClearedStatus>{cleared}</ClearedStatus>
        <AccountRef><FullName>Chase Checking</FullName></AccountRef>
      </CheckRet>
    </CheckQueryRs>
  </QBXMLMsgsRs>
</QBXML>"""


def _make_client(response_xml: str) -> MagicMock:
    """Create a mock QBClient whose _send() returns the given XML."""
    client = MagicMock()
    client._send.return_value = response_xml
    return client


# ── get_latest_sales_receipt ──────────────────────────────────────────────────

def test_get_latest_sales_receipt_found():
    from services.qb_activity_queries import get_latest_sales_receipt
    client = _make_client(_sr_xml())
    result = get_latest_sales_receipt(client)
    assert result["found"] is True
    assert result["last_txn_date"] == "2026-06-02"
    assert result["ref_number"] == "12345"
    assert result["amount"] == 120.50
    assert result["customer"] == "Toast Sales - Bandera"
    assert result["class_name"] == "Bandera"
    assert result["error"] is None


def test_get_latest_sales_receipt_empty():
    from services.qb_activity_queries import get_latest_sales_receipt
    client = _make_client(_empty_xml("SalesReceiptQueryRs"))
    result = get_latest_sales_receipt(client)
    assert result["found"] is False
    assert result["warning"] is not None
    assert result["error"] is None


def test_get_latest_sales_receipt_multiple_picks_latest():
    from services.qb_activity_queries import get_latest_sales_receipt
    xml = """<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRs>
    <SalesReceiptQueryRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">
      <SalesReceiptRet>
        <TxnID>A</TxnID><TxnDate>2026-05-01</TxnDate><RefNumber>100</RefNumber><TotalAmount>50.00</TotalAmount>
      </SalesReceiptRet>
      <SalesReceiptRet>
        <TxnID>B</TxnID><TxnDate>2026-06-03</TxnDate><RefNumber>200</RefNumber><TotalAmount>99.99</TotalAmount>
      </SalesReceiptRet>
      <SalesReceiptRet>
        <TxnID>C</TxnID><TxnDate>2026-06-01</TxnDate><RefNumber>150</RefNumber><TotalAmount>75.00</TotalAmount>
      </SalesReceiptRet>
    </SalesReceiptQueryRs>
  </QBXMLMsgsRs>
</QBXML>"""
    client = _make_client(xml)
    result = get_latest_sales_receipt(client)
    assert result["last_txn_date"] == "2026-06-03"
    assert result["ref_number"] == "200"


def test_get_latest_sales_receipt_qb_error():
    from services.qb_activity_queries import get_latest_sales_receipt
    client = MagicMock()
    client._send.side_effect = RuntimeError("QB connection refused")
    result = get_latest_sales_receipt(client)
    assert result["found"] is False
    assert result["error"] is not None
    assert "QB" in result["error"] or "error" in result["error"].lower()


# ── get_latest_invoice ────────────────────────────────────────────────────────

def test_get_latest_invoice_found():
    from services.qb_activity_queries import get_latest_invoice
    xml = """<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRs>
    <InvoiceQueryRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">
      <InvoiceRet>
        <TxnID>INV001</TxnID><TxnDate>2026-06-01</TxnDate>
        <RefNumber>INV-001</RefNumber><TotalAmount>500.00</TotalAmount>
        <CustomerRef><FullName>Acme Corp</FullName></CustomerRef>
      </InvoiceRet>
    </InvoiceQueryRs>
  </QBXMLMsgsRs>
</QBXML>"""
    result = get_latest_invoice(_make_client(xml))
    assert result["found"] is True
    assert result["last_txn_date"] == "2026-06-01"
    assert result["customer"] == "Acme Corp"


# ── get_latest_bank_transaction ───────────────────────────────────────────────

def test_get_latest_bank_transaction_no_account():
    from services.qb_activity_queries import get_latest_bank_transaction
    client = MagicMock()
    result = get_latest_bank_transaction(client, "")
    assert result["found"] is False
    assert result["warning"] is not None


def test_get_latest_bank_transaction_picks_most_recent():
    """Picks whichever of check/deposit is more recent."""
    from services.qb_activity_queries import get_latest_bank_transaction
    check_xml = _check_xml(txn_date="2026-06-01", cleared="NotCleared")
    deposit_xml = """<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRs>
    <DepositQueryRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">
      <DepositRet>
        <TxnID>DEP001</TxnID><TxnDate>2026-06-03</TxnDate><TotalAmount>1500.00</TotalAmount>
        <DepositToAccountRef><FullName>Chase Checking</FullName></DepositToAccountRef>
      </DepositRet>
    </DepositQueryRs>
  </QBXMLMsgsRs>
</QBXML>"""
    client = MagicMock()
    # First call (check), second call (deposit)
    client._send.side_effect = [check_xml, deposit_xml]
    result = get_latest_bank_transaction(client, "Chase Checking")
    assert result["found"] is True
    assert result["last_txn_date"] == "2026-06-03"  # deposit wins
    assert result["account"] == "Chase Checking"


def test_bank_account_filter_uses_qbxml_account_filter():
    from services import qb_activity_queries as queries
    assert queries._account_filter_xml("Chase Checking") == (
        "<AccountFilter><FullName>Chase Checking</FullName></AccountFilter>"
    )


# ── get_latest_reconcile_status ───────────────────────────────────────────────

def test_get_latest_reconcile_status_found():
    from services.qb_activity_queries import get_latest_reconcile_status
    check_xml = _check_xml(txn_date="2026-05-31", cleared="Reconciled")
    empty_deposit = _empty_xml("DepositQueryRs")
    client = MagicMock()
    client._send.side_effect = [check_xml, empty_deposit]
    result = get_latest_reconcile_status(client, "Chase Checking")
    assert result["found"] is True
    assert result["last_txn_date"] == "2026-05-31"
    assert result["cleared"] == "Reconciled"


def test_get_latest_reconcile_status_no_reconciled():
    from services.qb_activity_queries import get_latest_reconcile_status
    # Checks exist but none reconciled
    check_xml = _check_xml(txn_date="2026-06-01", cleared="NotCleared")
    empty_deposit = _empty_xml("DepositQueryRs")
    client = MagicMock()
    client._send.side_effect = [check_xml, empty_deposit]
    result = get_latest_reconcile_status(client, "Chase Checking")
    assert result["found"] is False
    assert result["warning"] is not None


def test_get_latest_reconcile_status_no_account():
    from services.qb_activity_queries import get_latest_reconcile_status
    result = get_latest_reconcile_status(MagicMock(), "")
    assert result["found"] is False
    assert result["warning"] is not None


# ── _parse_all_ret ────────────────────────────────────────────────────────────

def test_parse_all_ret_error_code():
    from services.qb_activity_queries import _parse_all_ret
    xml = """<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRs>
    <SalesReceiptQueryRs statusCode="-1" statusSeverity="Error" statusMessage="Bad query">
    </SalesReceiptQueryRs>
  </QBXMLMsgsRs>
</QBXML>"""
    elements, error = _parse_all_ret(xml, "SalesReceiptQueryRs", "SalesReceiptRet")
    assert elements == []
    assert error is not None
    assert "Bad query" in error


def test_parse_all_ret_status_1_no_records():
    from services.qb_activity_queries import _parse_all_ret
    xml = _empty_xml("SalesReceiptQueryRs")
    elements, error = _parse_all_ret(xml, "SalesReceiptQueryRs", "SalesReceiptRet")
    assert elements == []
    assert error is None  # status 1 = no records, not an error
