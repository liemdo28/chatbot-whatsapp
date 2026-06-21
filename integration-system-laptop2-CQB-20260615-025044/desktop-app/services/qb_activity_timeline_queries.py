"""
QB Activity Timeline Queries
=============================
Read-only QBXML queries that return ALL transactions for a given date or range,
not just the latest. Used by the timeline service to build a full daily event list.

NEVER modifies QB data.  Every request uses onError="continueOnError".

Return shape (all functions):
    list[dict] — each dict:
    {
        "txn_id":       str,
        "txn_type":     str,         # e.g. "sales_receipt", "deposit"
        "txn_date":     str,         # "YYYY-MM-DD"
        "time_created": str | None,  # "YYYY-MM-DDTHH:MM:SS" if available
        "time_modified": str | None, # "YYYY-MM-DDTHH:MM:SS" if available
        "ref_number":   str | None,
        "amount":       float | None,
        "customer":     str | None,
        "class_name":   str | None,
        "account":      str | None,
        "memo":         str | None,
        "cleared":      str | None,
        "extra":        dict,
    }
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from qb_client import QBClient

_log = logging.getLogger(__name__)


# ── Date helpers ──────────────────────────────────────────────────────────────

def _ago(days: int) -> str:
    return (date.today() - timedelta(days=days)).strftime("%Y-%m-%d")


def _today() -> str:
    return date.today().strftime("%Y-%m-%d")


# ── XML helpers ───────────────────────────────────────────────────────────────

def _float(element, *tags) -> float | None:
    for tag in tags:
        val = element.findtext(tag)
        if val is not None:
            try:
                return round(float(val), 2)
            except (ValueError, TypeError):
                pass
    return None


def _ref_name(element, *ref_tags) -> str:
    for tag in ref_tags:
        ref = element.find(tag)
        if ref is not None:
            name = ref.findtext("FullName", "")
            if name:
                return name
    return ""


def _parse_all_ret(response_xml: str, rs_tag: str, ret_tag: str) -> tuple[list, str | None]:
    """
    Parse all <ret_tag> elements from a QBXML response.
    Returns (elements_list, error_str_or_None).
    """
    try:
        root = ET.fromstring(response_xml)
    except ET.ParseError as exc:
        return [], f"QBXML parse error: {exc}"

    msgs = root.find(".//QBXMLMsgsRs")
    if msgs is None:
        return [], "No QBXMLMsgsRs in response"

    rs = msgs.find(rs_tag)
    if rs is None:
        return [], None

    code = rs.get("statusCode", "-1")
    msg = rs.get("statusMessage", "")
    if code == "1":
        return [], None
    if code != "0":
        return [], f"QB query error [{code}]: {msg}"

    return [c for c in rs if c.tag == ret_tag], None


def _send_read_only(client: "QBClient", qbxml: str, rs_tag: str, ret_tag: str) -> tuple[list, str | None]:
    """Send QBXML request and parse results."""
    try:
        resp = client._send(qbxml)
    except Exception as exc:
        return [], f"QB send error: {exc}"
    return _parse_all_ret(resp, rs_tag, ret_tag)


# ── Query builder ─────────────────────────────────────────────────────────────

def _make_txn_qbxml(rq_tag: str, *, from_date: str, to_date: str,
                    account_filter: str = "", extra: str = "",
                    max_returned: int = 500) -> str:
    return f"""<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXML>
  <QBXMLMsgsRq onError="continueOnError">
    <{rq_tag} requestID="1">
      <MaxReturned>{max_returned}</MaxReturned>
      {account_filter}
      <TxnDateRangeFilter>
        <FromTxnDate>{from_date}</FromTxnDate>
        <ToTxnDate>{to_date}</ToTxnDate>
      </TxnDateRangeFilter>
      {extra}
    </{rq_tag}>
  </QBXMLMsgsRq>
</QBXML>"""


def _account_filter_xml(account_name: str) -> str:
    if not account_name:
        return ""
    from qb_client import escape_xml
    return f"<AccountFilter><FullName>{escape_xml(account_name)}</FullName></AccountFilter>"


# ── Element → event dict ──────────────────────────────────────────────────────

def _element_to_event(el: ET.Element, txn_type: str, *, account: str | None = None) -> dict:
    """Convert an XML element to a timeline event dict."""
    return {
        "txn_id": el.findtext("TxnID"),
        "txn_type": txn_type,
        "txn_date": el.findtext("TxnDate"),
        "time_created": el.findtext("TimeCreated"),
        "time_modified": el.findtext("TimeModified"),
        "ref_number": el.findtext("RefNumber"),
        "amount": _float(el, "Amount", "TotalAmount", "Subtotal"),
        "customer": _ref_name(el, "CustomerRef", "EntityRef", "PayeeEntityRef"),
        "class_name": _ref_name(el, "ClassRef"),
        "account": account or _ref_name(el, "AccountRef", "DepositToAccountRef"),
        "memo": el.findtext("Memo"),
        "cleared": el.findtext("ClearedStatus"),
        "extra": {},
    }


# ── Public timeline query functions ───────────────────────────────────────────

def query_sales_receipts(client: "QBClient", target_date: str, *, days_back: int = 0) -> tuple[list[dict], str | None]:
    """All sales receipts on target_date (or range if days_back > 0)."""
    from_date = _ago(days_back) if days_back else target_date
    qbxml = _make_txn_qbxml(
        "SalesReceiptQueryRq",
        from_date=from_date, to_date=target_date,
        extra="<IncludeLineItems>false</IncludeLineItems>",
    )
    elements, error = _send_read_only(client, qbxml, "SalesReceiptQueryRs", "SalesReceiptRet")
    if error:
        return [], error
    return [_element_to_event(el, "sales_receipt") for el in elements], None


def query_invoices(client: "QBClient", target_date: str, *, days_back: int = 0) -> tuple[list[dict], str | None]:
    from_date = _ago(days_back) if days_back else target_date
    qbxml = _make_txn_qbxml(
        "InvoiceQueryRq",
        from_date=from_date, to_date=target_date,
        extra="<IncludeLineItems>false</IncludeLineItems>",
    )
    elements, error = _send_read_only(client, qbxml, "InvoiceQueryRs", "InvoiceRet")
    if error:
        return [], error
    return [_element_to_event(el, "invoice") for el in elements], None


def query_payments(client: "QBClient", target_date: str, *, days_back: int = 0) -> tuple[list[dict], str | None]:
    from_date = _ago(days_back) if days_back else target_date
    qbxml = _make_txn_qbxml(
        "ReceivePaymentQueryRq",
        from_date=from_date, to_date=target_date,
    )
    elements, error = _send_read_only(client, qbxml, "ReceivePaymentQueryRs", "ReceivePaymentRet")
    if error:
        return [], error
    return [_element_to_event(el, "payment") for el in elements], None


def query_deposits(client: "QBClient", target_date: str, *, account: str = "", days_back: int = 0) -> tuple[list[dict], str | None]:
    from_date = _ago(days_back) if days_back else target_date
    acct_xml = _account_filter_xml(account) if account else ""
    qbxml = _make_txn_qbxml(
        "DepositQueryRq",
        from_date=from_date, to_date=target_date,
        account_filter=acct_xml,
    )
    elements, error = _send_read_only(client, qbxml, "DepositQueryRs", "DepositRet")
    if error:
        return [], error
    return [_element_to_event(el, "deposit", account=account or None) for el in elements], None


def query_journal_entries(client: "QBClient", target_date: str, *, days_back: int = 0) -> tuple[list[dict], str | None]:
    from_date = _ago(days_back) if days_back else target_date
    qbxml = _make_txn_qbxml(
        "JournalEntryQueryRq",
        from_date=from_date, to_date=target_date,
    )
    elements, error = _send_read_only(client, qbxml, "JournalEntryQueryRs", "JournalEntryRet")
    if error:
        return [], error
    events = []
    for el in elements:
        ev = _element_to_event(el, "journal_entry")
        debit_total = sum(
            float(line.findtext("Amount", "0") or 0)
            for line in el.findall(".//JournalDebitLine")
        )
        if debit_total:
            ev["amount"] = round(debit_total, 2)
        events.append(ev)
    return events, None


def query_bills(client: "QBClient", target_date: str, *, days_back: int = 0) -> tuple[list[dict], str | None]:
    from_date = _ago(days_back) if days_back else target_date
    qbxml = _make_txn_qbxml(
        "BillQueryRq",
        from_date=from_date, to_date=target_date,
        extra="<IncludeLineItems>false</IncludeLineItems>",
    )
    elements, error = _send_read_only(client, qbxml, "BillQueryRs", "BillRet")
    if error:
        return [], error
    events = []
    for el in elements:
        ev = _element_to_event(el, "bill")
        ev["customer"] = _ref_name(el, "VendorRef") or ev["customer"]
        events.append(ev)
    return events, None


def query_checks(client: "QBClient", target_date: str, *, account: str = "", days_back: int = 0) -> tuple[list[dict], str | None]:
    from_date = _ago(days_back) if days_back else target_date
    acct_xml = _account_filter_xml(account) if account else ""
    qbxml = _make_txn_qbxml(
        "CheckQueryRq",
        from_date=from_date, to_date=target_date,
        account_filter=acct_xml,
    )
    elements, error = _send_read_only(client, qbxml, "CheckQueryRs", "CheckRet")
    if error:
        return [], error
    return [_element_to_event(el, "check", account=account or None) for el in elements], None


def query_all_for_date(
    client: "QBClient",
    target_date: str,
    *,
    bank_accounts: list[str] | None = None,
    include_types: list[str] | None = None,
) -> tuple[list[dict], list[str], list[str]]:
    """
    Run all timeline queries for a target date.
    Returns (events, warnings, errors).
    """
    bank_accounts = bank_accounts or []
    include_types = include_types or [
        "sales_receipt", "invoice", "payment", "deposit",
        "journal_entry", "bill", "check",
    ]

    events: list[dict] = []
    warnings: list[str] = []
    errors: list[str] = []

    _QUERY_MAP = {
        "sales_receipt": lambda: query_sales_receipts(client, target_date),
        "invoice": lambda: query_invoices(client, target_date),
        "payment": lambda: query_payments(client, target_date),
        "deposit": lambda: query_deposits(client, target_date),
        "journal_entry": lambda: query_journal_entries(client, target_date),
        "bill": lambda: query_bills(client, target_date),
        "check": lambda: query_checks(client, target_date),
    }

    for txn_type, query_fn in _QUERY_MAP.items():
        if txn_type not in include_types:
            continue
        try:
            results, error = query_fn()
            if error:
                errors.append(f"{txn_type}: {error}")
            elif not results:
                warnings.append(f"No {txn_type} transactions found on {target_date}.")
            else:
                events.extend(results)
        except Exception as exc:
            errors.append(f"{txn_type}: unexpected error: {exc}")

    # Bank-specific queries (checks + deposits per account)
    if "bank_transaction" in include_types:
        for acct in bank_accounts:
            try:
                chk, err1 = query_checks(client, target_date, account=acct)
                dep, err2 = query_deposits(client, target_date, account=acct)
                if err1:
                    errors.append(f"bank_check[{acct}]: {err1}")
                if err2:
                    errors.append(f"bank_deposit[{acct}]: {err2}")
                # Mark as bank_transaction type
                for ev in chk + dep:
                    ev["txn_type"] = "bank_transaction"
                    ev["account"] = acct
                events.extend(chk + dep)
            except Exception as exc:
                errors.append(f"bank_transaction[{acct}]: {exc}")

    return events, warnings, errors
