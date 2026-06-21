# COLUMN_SELECTION_RULE_REPORT.md
## DEV1 — Column Selection Rule Report
**Date:** 2026-06-19

---

## 1. Old Rule (REMOVED)

The old system required manual selection between column 1 and column 2 every time.

**Problem:** Users found this confusing and error-prone. Many submissions were delayed because employees didn't understand the selection prompt.

---

## 2. New Rule (IMPLEMENTED)

### Automatic Column Selection Algorithm

```
Step 1: Count filled cells in each column
  ten_filled = count cells with non-null value in 10am column
  four_filled = count cells with non-null value in 4pm column

Step 2: Apply rules:
  IF four_filled > 0 AND ten_filled > 0:
      SELECT 4pm (Rule: 4pm is the later/current record when both are filled)
  ELIF four_filled > 0:
      SELECT 4pm
  ELIF ten_filled > 0:
      SELECT 10am
  ELSE:
      SELECT 4pm (default fallback)
```

### When to Ask User

Only ask the user if:
1. Both columns have values AND confidence is too low (< 30%)
2. Both columns have values AND filled ratio difference < 10% (ambiguous)

### Confidence Thresholds

| Threshold | Value | Meaning |
|-----------|-------|---------|
| `MIN_CONFIDENCE` | 0.30 | Minimum confidence to count a cell as "filled" |
| `AMBIGUITY_THRESHOLD` | 0.10 | Filled ratio diff below this = ask user |
| `MIN_FILLED_FOR_AUTO` | 1 | Minimum filled cells to auto-select |

---

## 3. Implementation

In `column_selector.py`:

```python
def select_column_auto(ten_am, four_pm):
    ten_filled = count_filled_cells(ten_am)
    four_filled = count_filled_cells(four_pm)
    
    if four_filled > 0 and ten_filled > 0:
        return "4pm", "both_columns_filled_prefer_4pm_later_record"
    elif four_filled > 0:
        return "4pm", "only_4pm_column_has_values"
    elif ten_filled > 0:
        return "10am", "only_10am_column_has_values"
    else:
        return "4pm", "fallback_default_4pm"
```

---

## 4. Rationale

**Why 4pm when both columns are filled?**
- 4:00 PM is the end-of-day record
- 10:00 AM is the opening shift record
- When both shifts are filled, the 4pm record supersedes the 10am record
- This mirrors real-world food safety practice: 4pm is the final verification of the day

**Why 4pm as default?**
- Most forms submitted after 10am will have 4pm values
- Reduces user prompts
- Error: selecting 4pm when 10am was intended → user can EDIT
- Error: selecting 10am when 4pm was intended → more serious (misses the day's final check)

---

## 5. Edge Cases

| Scenario | Auto-Select | Ask User? |
|----------|------------|---------|
| Only 10am filled | 10am | No |
| Only 4pm filled | 4pm | No |
| Both filled | 4pm | Only if ambiguous |
| Neither filled | 4pm | Yes |
| Both filled, conf<30% | 4pm | Yes (low confidence) |
