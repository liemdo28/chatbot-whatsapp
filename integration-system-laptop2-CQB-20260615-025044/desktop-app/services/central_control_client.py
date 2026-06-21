"""
central_control_client.py
==========================
Compatibility shim — re-exports MiCoreClient as CentralControlClient.
Old code that imported agent_coding_client still works through this module.

Usage:
    from services.central_control_client import get_client
    client = get_client()
    client.heartbeat()
"""
from services.mi_core_client import MiCoreClient, get_client, get_central_config, get_api_key, get_base_url, is_enabled

CentralControlClient = MiCoreClient

__all__ = [
    "CentralControlClient",
    "MiCoreClient",
    "get_client",
    "get_central_config",
    "get_api_key",
    "get_base_url",
    "is_enabled",
]
