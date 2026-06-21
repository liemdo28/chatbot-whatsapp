from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

ROOT = Path(r"e:\Project\Master\Bakudan\integration-system")
CREDENTIALS = ROOT / "credentials.json"
TOKEN = ROOT / "token_sheets_validation.json"
OUTPUT = ROOT / "reports" / "evidence" / "google_sheet_validation_result.json"

SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/spreadsheets",
]


def auth():
    creds = None
    if TOKEN.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS), SCOPES)
        creds = flow.run_local_server(port=0)
    TOKEN.write_text(creds.to_json(), encoding="utf-8")
    return creds


def main():
    creds = auth()
    sheets = build("sheets", "v4", credentials=creds)

    title = "Bakudan QB Remote Ops Report"
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    tab_name = "Validation"

    create_body = {
        "properties": {"title": title},
        "sheets": [{"properties": {"title": tab_name}}],
    }
    spreadsheet = sheets.spreadsheets().create(body=create_body).execute()
    spreadsheet_id = spreadsheet["spreadsheetId"]
    spreadsheet_url = spreadsheet["spreadsheetUrl"]
    sheet_id = spreadsheet["sheets"][0]["properties"]["sheetId"]

    append_values = [["created_at", "status", "note"], [timestamp, "CREATED", "initial append"]]
    append_result = sheets.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{tab_name}!A:C",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": append_values},
    ).execute()

    update_values = [[timestamp, "UPDATED", "row updated successfully"]]
    update_result = sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{tab_name}!A2:C2",
        valueInputOption="USER_ENTERED",
        body={"values": update_values},
    ).execute()

    add_tab_result = sheets.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={
            "requests": [
                {"addSheet": {"properties": {"title": "ReconnectCheck"}}}
            ]
        },
    ).execute()

    # reconnect proof: rebuild client from saved token and read values
    creds2 = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if creds2.expired and creds2.refresh_token:
        creds2.refresh(Request())
    sheets2 = build("sheets", "v4", credentials=creds2)
    read_back = sheets2.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab_name}!A1:C2",
    ).execute()

    result = {
        "ok": True,
        "spreadsheet_id": spreadsheet_id,
        "spreadsheet_url": spreadsheet_url,
        "sheet_title": title,
        "created_tab": tab_name,
        "created_sheet_id": sheet_id,
        "append_updates": append_result.get("updates", {}),
        "update_result": update_result,
        "add_tab_result": add_tab_result,
        "reconnect_read_back": read_back,
        "validated_at": datetime.now(timezone.utc).isoformat(),
    }
    OUTPUT.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
