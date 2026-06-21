const { getStoreGroup } = require("./submissionDueConfig");
const { ensureTable, wasAlertSentToday, recordAlert } = require("./alertAuditLog");
const logger = require("./logger");

let clientManager = null;

function setClientManager(cm) {
    clientManager = cm;
}

function toGroupChatId(value) {
    if (!value) return null;
    if (String(value).includes("@")) return String(value);
    return `${value}@g.us`;
}

const resolvedGroupIds = new Map();

async function resolveGroupChatId(value) {
    if (!value) return null;
    const raw = String(value);
    if (raw.includes("@")) return raw;
    if (resolvedGroupIds.has(raw)) return resolvedGroupIds.get(raw);

    try {
        const client = clientManager && clientManager.getClient ? clientManager.getClient() : null;
        if (!client || !client.getChats) return toGroupChatId(raw);
        const chats = await client.getChats();
        const match = chats.find((chat) => chat.isGroup && String(chat.name || "").toLowerCase() === raw.toLowerCase());
        if (match && match.id && match.id._serialized) {
            resolvedGroupIds.set(raw, match.id._serialized);
            return match.id._serialized;
        }
    } catch (err) {
        logger.warn("[ManagerAlertService] Failed to resolve group name", { group: raw, error: err.message });
    }

    return toGroupChatId(raw);
}

function managerTag(storeGroup) {
    const phone = storeGroup && storeGroup.manager_phone;
    if (!phone) return storeGroup && storeGroup.manager_name ? storeGroup.manager_name : "Manager";
    return `@${String(phone).replace(/\D/g, "")}`;
}

function buildManagementMessage(alert, storeGroup) {
    const issue = alert.issue || alert.label || "food_safety_alert";
    const action = alert.action_needed || "Review and respond.";
    const ref = alert.message_reference ? `\nReference: ${alert.message_reference}` : "";
    const reasonLines = Array.isArray(alert.reason_lines) && alert.reason_lines.length > 0
        ? ["Reason:", ...alert.reason_lines.map((line) => `- ${line}`)]
        : [];
    return [
        `FOOD SAFETY ALERT`,
        ``,
        `Store: ${storeGroup.store_name} / ${storeGroup.store_code}`,
        `Group: ${storeGroup.group_name}`,
        `Issue: ${issue}`,
        `Manager: ${storeGroup.manager_name} ${managerTag(storeGroup)}`,
        ...reasonLines,
        `Action: ${action}`,
        ref.trim(),
        ``,
        alert.es || alert.en || "",
    ].filter((line) => line !== "").join("\n");
}

async function sendChatMessage(chatId, message) {
    if (!chatId || !clientManager) return false;
    const status = clientManager.getStatus();
    if (!status || status.status !== "CONNECTED") {
        logger.warn("[ManagerAlertService] WhatsApp not connected", { chatId, status: status && status.status });
        return false;
    }
    await clientManager.sendMessage(chatId, message);
    return true;
}

async function sendAlert(alert, storeGroup) {
    ensureTable();
    if (!storeGroup) {
        storeGroup = getStoreGroup(alert.store_id || alert.store_code);
    }
    if (!storeGroup) {
        return { sent: false, reason: "no_store_group" };
    }

    if (wasAlertSentToday(alert.store_id || storeGroup.store_id, alert.label)) {
        recordAlert(alert, { suppressed: true, suppress_reason: "duplicate_today" });
        return { sent: false, suppressed: true, reason: "duplicate_today" };
    }

    const managementMessage = buildManagementMessage(alert, storeGroup);
    const sourceMessage = alert.es || alert.en || managementMessage;
    const managementIds = [
        storeGroup.management_group_id,
        ...(storeGroup.management_group_ids || []),
    ].filter(Boolean);
    const sourceIds = [
        storeGroup.group_id,
        ...(storeGroup.group_ids || []),
    ].filter(Boolean);

    let sentToManagement = false;
    let sentToSourceGroup = false;

    for (const id of managementIds) {
        try {
            if (await sendChatMessage(await resolveGroupChatId(id), managementMessage)) sentToManagement = true;
        } catch (e) {
            logger.error("[ManagerAlertService] Failed to send management alert", {
                error: e.message,
                store_id: storeGroup.store_id,
                target: id,
            });
        }
    }

    if (alert.send_to_source_group !== false && storeGroup.alert_targets && storeGroup.alert_targets.source_group) {
        for (const id of sourceIds) {
            if (id === storeGroup.management_group_id) continue;
            try {
                if (await sendChatMessage(await resolveGroupChatId(id), sourceMessage)) sentToSourceGroup = true;
            } catch (e) {
                logger.error("[ManagerAlertService] Failed to send source-group alert", {
                    error: e.message,
                    store_id: storeGroup.store_id,
                    target: id,
                });
            }
        }
    }

    recordAlert(alert, {
        sent_to_management_group: sentToManagement,
        sent_to_group: sentToSourceGroup,
        sent_to_manager: false,
        sent_to_admin: false,
    });

    return {
        sent: sentToManagement || sentToSourceGroup,
        sent_to_management_group: sentToManagement,
        sent_to_group: sentToSourceGroup,
        manager_tag: managerTag(storeGroup),
    };
}

module.exports = {
    setClientManager,
    sendAlert,
    buildManagementMessage,
    managerTag,
};
