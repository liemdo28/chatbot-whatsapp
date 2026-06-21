# Food Safety Employee Commands Report

**Date:** 2026-06-17

---

## All Supported Commands

| Command | Syntax | Description | Language |
|---------|--------|-------------|----------|
| CONFIRM | `CONFIRM` | Save the record to DB | ES/EN |
| EDIT | `EDIT <index> <value>` | Correct a temperature by line number | ES/EN |
| EDIT | `EDIT <id> <value>` | Correct a temperature by item ID | ES/EN |
| RETAKE | `RETAKE` | Request a new photo | ES/EN |
| MANAGER | `MANAGER` | Send to manager review | ES/EN |
| CANCEL | `CANCEL` | Cancel this record | ES/EN |
| HELP | `HELP` or `AYUDA` | Show instructions | ES/EN |
| LANGUAGE | `EN`, `English`, `ES`, `Español`, `Spanish` | Switch language | ES/EN |

---

## Spanish Response Examples

### CONFIRM
```
✅ Registro guardado exitosamente.

ID: 42
Tienda: StoneOak
Fecha: 2026-06-17T07:42:00.000Z
```

### EDIT 3 38
```
✏️ Edición aplicada: SO-03 (Prep Cooler) actualizado de 42°F a 38°F
```

### EDIT SO-03 38
```
✏️ Edición aplicada: SO-03 (Prep Cooler) actualizado de 42°F a 38°F
```

### RETAKE
```
📸 Por favor envíe una nueva foto clara del formulario.
```

### MANAGER
```
👨‍💼 Enviado a revisión del manager. El manager será notificado.
```

### CANCEL
```
❌ Registro cancelado.
```

### HELP
```
Cómo usar el bot:

1. Complete el formulario de Food Safety.
2. Tome una foto clara.
3. Envíela a este grupo.
4. Revise los valores detectados.
5. Use CONFIRM, EDIT, RETAKE, MANAGER o CANCEL.

Ejemplos:
EDIT 3 38
EDIT SO-03 38
RETAKE
CONFIRM

Otros comandos:
LANGUAGE = cambiar idioma
HELP = ver esta ayuda
```

---

## English Response Examples

### CONFIRM
```
✅ Record saved successfully.

ID: 42
Store: StoneOak
Date: 2026-06-17T07:42:00.000Z
```

### EDIT 3 38
```
✏️ Edit applied: SO-03 (Prep Cooler) updated from 42°F to 38°F
```

### EDIT SO-03 38
```
✏️ Edit applied: SO-03 (Prep Cooler) updated from 42°F to 38°F
```

### RETAKE
```
📸 Please send a new clear photo of the form.
```

### MANAGER
```
👨‍💼 Sent to manager review. The manager will be notified.
```

### CANCEL
```
❌ Record cancelled.
```

### HELP
```
How to use the bot:

1. Complete the Food Safety form.
2. Take a clear photo.
3. Send it to this group.
4. Review the detected values.
5. Use CONFIRM, EDIT, RETAKE, MANAGER or CANCEL.

Examples:
EDIT 3 38
EDIT SO-03 38
RETAKE
CONFIRM

Other commands:
LANGUAGE = switch language
HELP = show this help
```

---

## OCR Summary with Instructions (Spanish)

When employee sends a form photo, the bot replies:

```
✅ Análisis completado. Valores detectados:

📋 *Valores detectados:*

✅ SO-01 - Walk-In Cooler: 38°F (Rango: 30–45°F)
✅ SO-02 - Walk-In Freezer: -5°F (Rango: -10–0°F)
✅ SO-03 - Prep Cooler: 42°F (Rango: 30–45°F)
...

Responde con una opción:

CONFIRM = guardar el registro
Ejemplo: CONFIRM

EDIT = corregir una temperatura
Ejemplo: EDIT 3 38
Ejemplo: EDIT SO-03 38

RETAKE = enviar una foto más clara
Ejemplo: RETAKE

MANAGER = enviar a revisión del manager
Ejemplo: MANAGER

CANCEL = cancelar este registro
Ejemplo: CANCEL

HELP = ver instrucciones
Ejemplo: HELP
```

---

## Command Test Results

| Test | Result |
|------|--------|
| CONFIRM command (Spanish) | ✅ PASS |
| CONFIRM command (English) | ✅ PASS |
| EDIT command - by index | ✅ PASS |
| EDIT command - by ID | ✅ PASS |
| RETAKE command | ✅ PASS |
| MANAGER command | ✅ PASS |
| CANCEL command | ✅ PASS |
| HELP command (via handler) | ✅ PASS |
| No pending message for CONFIRM | ✅ PASS |
| No pending message for EDIT | ✅ PASS |

**10/10 command tests passed**
