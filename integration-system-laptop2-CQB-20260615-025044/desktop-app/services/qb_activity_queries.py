"""
QB Activity Queries
===================
Read-only QBXML queries for the QB activity log system.
All functions accept a connected QBClient instance.

NEVER modifies QB data.  Every request uses onError="continueOnError" so a
missing transaction type does not abort the whole log run.

Return shape (all functions):
    {
        "found":        bool,
        "last_txn_date": str | None,   # "YYYY-MM-DD"
        "ref_number":   str | None,
        "amount":       float | None,
        "customer":     str | None,
        "class_name":   str | None,
        "account":      str | None,
        "memo":         str | None,
        "cleared":      str | None,    # reconcile/cleared status
        "txn_id":       str | None,
        "extra":        dict,          # any type-specific fields
        "warning":      str | None,    # soft problem — not a hard error
        "error":        str | None,    # hard problem that prevented query
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

_EMPTY = {
    "found": False,
    "last_txn_date": None,
    "ref_number": None,
    "amount": None,
    "customer": None,
    "class_name": None,
    "account": None,
    "memo": None,
    "cleared": None,
    "txn_id": None,
    "extra": {},
    "warning": None,
    "error": None,
}


def _empty(warning: str | None = None, error: str | None = None) -> dict:
    r = dict(_EMPTY)
    r["warning"] = warning
    r["error"] = error
    return r


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
    statusCode "1" = no records found — returns empty list, no error.
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
        return [], None  # response element not present — treat as no data

    code = rs.get("statusCode", "-1")
    msg = rs.get("statusMessage", "")
    if code == "1":     # No record found
        return [], None
    if code != "0":
        return [], f"QB query error [{code}]: {msg}"

    return [c for c in rs if c.tag == ret_tag], None


def _send_read_only(client: "QBClient", qbxml: str, rs_tag: str, ret_tag: str) -> tuple[list, str | None]:
    """Send QBXML request and parse results. Returns (elements, error_or_None)."""
    try:
        resp = client._send(qbxml)
    except Exception as exc:
        return [], f"QB send error: {exc}"
    return _parse_all_ret(resp, rs_tag, ret_tag)


def _pick_latest(elements: list, date_tag: str = "TxnDate") -> ET.Element | None:
    """Return element with the most recent date."""
    best = None
    best_date = ""
    for el in elements:
        d = el.findtext(date_tag, "")
        if d > best_date:
            best_date = d
            best = el
    return best


def _build_result(el: ET.Element | None, *, account: str | None = None) -> dict:
    """Convert an ET.Element transaction to the standard result dict."""
    if el is None:
        return _empty()
    r = dict(_EMPTY)
    r["found"] = True
    r["txn_id"] = el.findtext("TxnID")
    r["last_txn_date"] = el.findtext("TxnDate")
    r["ref_number"] = el.findtext("RefNumber")
    r["amount"] = _float(el, "Amount", "TotalAmount", "Subtotal")
    r["customer"] = _ref_name(el, "CustomerRef", "EntityRef", "PayeeEntityRef")
    r["class_name"] = _ref_name(el, "ClassRef")
    r["account"] = account or _ref_name(el, "AccountRef", "DepositToAccountRef")
    r["memo"] = el.findtext("Memo")
    r["cleared"] = el.findtext("ClearedStatus")
    r["extra"] = {}
    return r


# ── Query builders ────────────────────────────────────────────────────────────

def _make_txn_qbxml(rq_tag: str, *, from_date: str, to_date: str,
                    account_filter: str = "", extra: str = "", max_returned: int = 200) -> str:
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


# ── Public query functions ────────────────────────────────────────────────────

def get_latest_sales_receipt(client: "QBClient", *, days_back: int = 90) -> dict:
    """Latest Sales Receipt in QB (last `days_back` days)."""
    qbxml = _make_txn_qbxml(
        "SalesReceiptQueryRq",
        from_date=_ago(days_back), to_date=_today(),
        extra="<IncludeLineItems>false</IncludeLineItems>",
    )
    elements, error = _send_read_only(client, qbxml, "SalesReceiptQueryRs", "SalesReceiptRet")
    if error:
        return _empty(error=error)
    if not elements:
        return _empty(warning=f"No sales receipts found in last {days_back} days.")
    best = _pick_latest(elements)
    r = _build_result(best)
    r["extra"]["total_receipts_scanned"] = len(elements)
    return r


def get_latest_invoice(client: "QBClient", *, days_back: int = 90) -> dict:
    """Latest Invoice."""
    qbxml = _make_txn_qbxml(
        "InvoiceQueryRq",
        from_date=_ago(days_back), to_date=_today(),
        extra="<IncludeLineItems>false</IncludeLineItems>",
    )
    elements, error = _send_read_only(client, qbxml, "InvoiceQueryRs", "InvoiceRet")
    if error:
        return _empty(error=error)
    if not elements:
        return _empty(warning=f"No invoices found in last {days_back} days.")
    return _build_result(_pick_latest(elements))


def get_latest_payment(client: "QBClient", *, days_back: int = 90) -> dict:
    """Latest Receive Payment."""
    qbxml = _make_txn_qbxml(
        "ReceivePaymentQueryRq",
        from_date=_ago(days_back), to_date=_today(),
    )
    elements, error = _send_read_only(client, qbxml, "ReceivePaymentQueryRs", "ReceivePaymentRet")
    if error:
        return _empty(error=error)
    if not elements:
        return _empty(warning=f"No payments found in last {days_back} days.")
    return _build_result(_pick_latest(elements))


def get_latest_deposit(client: "QBClient", *, account: str = "", days_back: int = 90) -> dict:
    """Latest Deposit, optionally filtered to a specific bank account."""
    acct_xml = _account_filter_xml(account) if account else ""
    qbxml = _make_txn_qbxml(
        "DepositQueryRq",
        from_date=_ago(days_back), to_date=_today(),
        account_filter=acct_xml,
    )
    elements, error = _send_read_only(client, qbxml, "DepositQueryRs", "DepositRet")
    if error:
        return _empty(error=error)
    if not elements:
        return _empty(warning=f"No deposits found in last {days_back} days.")
    best = _pick_latest(elements)
    r = _build_result(best, account=account or None)
    if not r["account"]:
        r["account"] = _ref_name(best, "DepositToAccountRef") if best is not None else None
    return r


def get_latest_journal_entry(client: "QBClient", *, days_back: int = 90) -> dict:
    """Latest General Journal Entry."""
    qbxml = _make_txn_qbxml(
        "JournalEntryQueryRq",
        from_date=_ago(days_back), to_date=_today(),
    )
    elements, error = _send_read_only(client, qbxml, "JournalEntryQueryRs", "JournalEntryRet")
    if error:
        return _empty(error=error)
    if not elements:
        return _empty(warning=f"No journal entries found in last {days_back} days.")
    best = _pick_latest(elements)
    r = _build_result(best)
    # JE amount = sum of debit lines
    if best is not None:
        debit_total = sum(
            float(line.findtext("Amount", "0") or 0)
            for line in best.findall(".//JournalDebitLine")
        )
        if debit_total:
            r["amount"] = round(debit_total, 2)
    return r


def get_latest_bill(client: "QBClient", *, days_back: int = 90) -> dict:
    """Latest Bill (Accounts Payable)."""
    qbxml = _make_txn_qbxml(
        "BillQueryRq",
        from_date=_ago(days_back), to_date=_today(),
        extra="<IncludeLineItems>false</IncludeLineItems>",
    )
    elements, error = _send_read_only(client, qbxml, "BillQueryRs", "BillRet")
    if error:
        return _empty(error=error)
    if not elements:
        return _empty(warning=f"No bills found in last {days_back} days.")
    best = _pick_latest(elements)
    r = _build_result(best)
    # Vendor is in VendorRef
    if best is not None:
        r["customer"] = _ref_name(best, "VendorRef") or r["customer"]
    return r


def get_latest_check(client: "QBClient", *, account: str = "", days_back: int = 90) -> dict:
    """Latest Check transaction (useful as bank activity proxy)."""
    acct_xml = _account_filter_xml(account) if account else ""
    qbxml = _make_txn_qbxml(
        "CheckQueryRq",
        from_date=_ago(days_back), to_date=_today(),
        account_filter=acct_xml,
    )
    elements, error = _send_read_only(client, qbxml, "CheckQueryRs", "CheckRet")
    if error:
        return _empty(error=error)
    if not elements:
        return _empty(warning=f"No checks found in last {days_back} days.")
    best = _pick_latest(elements)
    r = _build_result(best, account=account or None)
    return r


def get_latest_bank_transaction(client: "QBClient", account_name: str, *, days_back: int = 90) -> dict:
    """
    Latest bank-account transaction (Check or Deposit) for a given account.
    QB has no direct "bank feed" query — this is the best QBXML equivalent.
    """
    if not account_name:
        return _empty(warning="No bank account name specified for bank transaction query.")

    check_result  = get_latest_check(client, account=account_name, days_back=days_back)
    deposit_result = get_latest_deposit(client, account=account_name, days_back=days_back)

    # Pick whichever has the most recent date
    cd = check_result.get("last_txn_date") or ""
    dd = deposit_result.get("last_txn_date") or ""

    if not cd and not dd:
        return _empty(
            warning=f"No bank transactions found for account '{account_name}' in last {days_back} days.",
        )

    best = check_result if cd >= dd else deposit_result
    best = dict(best)
    best["account"] = account_name
    best["extra"]["source"] = "check" if cd >= dd else "deposit"
    return best


def get_latest_reconcile_status(client: "QBClient", account_name: str, *, days_back: int = 400) -> dict:
    """
    Approximate last-reconcile date by finding the most recent transaction on the
    given account whose ClearedStatus = 'Reconciled'.

    QB QBXML does not expose a direct reconcile-history endpoint; this is the
    closest read-only proxy available.
    """
    if not account_name:
        return _empty(warning="No account name specified for reconcile query.")

    acct_xml = _account_filter_xml(account_name)

    # Query both checks and deposits — whichever has reconciled items
    check_xml = _make_txn_qbxml(
        "CheckQueryRq",
        from_date=_ago(days_back), to_date=_today(),
        account_filter=acct_xml, max_returned=500,
    )
    deposit_xml = _make_txn_qbxml(
        "DepositQueryRq",
        from_date=_ago(days_back), to_date=_today(),
        account_filter=acct_xml, max_returned=500,
    )

    checks,   err1 = _send_read_only(client, check_xml,   "CheckQueryRs",   "CheckRet")
    deposits, err2 = _send_read_only(client, deposit_xml, "DepositQueryRs", "DepositRet")

    errors = [e for e in (err1, err2) if e]

    reconciled = [
        el for el in (checks + deposits)
        if el.findtext("ClearedStatus", "") == "Reconciled"
    ]

    if not reconciled:
        warning = f"No reconciled transactions found for '{account_name}' in last {days_back} days."
        if errors:
            warning += f" Query errors: {'; '.join(errors)}"
        return _empty(warning=warning)

    best = _pick_latest(reconciled)
    r = _build_result(best, account=account_name)
    r["extra"]["reconciled_txn_count"] = len(reconciled)
    r["extra"]["query_errors"] = errors if errors else None
    r["cleared"] = "Reconciled"

    # Ending balance is not directly available — note it
    r["extra"]["note"] = (
        "last_txn_date is the date of the last transaction marked Reconciled. "
        "Ending balance is not available via QBXML."
    )
    return r
