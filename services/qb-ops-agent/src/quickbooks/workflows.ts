import { CompanyFileRecord } from '../storage/local-db';
import { runBankFeedCheck } from '../workflows/bank-feed-check';
import { runCcExpenseCheck } from '../workflows/cc-expense-check';
import { runDailyAccountingCheck } from '../workflows/daily-accounting-check';
import { runReconcileCheck } from '../workflows/reconcile-check';
import { runSalesReceiptCheck } from '../workflows/sales-receipt-check';

export interface WorkflowAction {
  name: string;
  status: 'done' | 'missing' | 'failed' | 'needs_user';
  message: string;
  timestamp: string;
}

export interface WorkflowResult {
  workflow: string;
  company_file: string;
  status: 'success' | 'warning' | 'failed' | 'needs_user';
  actions: WorkflowAction[];
}

export async function runAllPhase1Workflows(companyFile: CompanyFileRecord): Promise<WorkflowResult[]> {
  return [
    await runDailyAccountingCheck(companyFile),
    await runSalesReceiptCheck(companyFile),
    await runBankFeedCheck(companyFile),
    await runReconcileCheck(companyFile),
    await runCcExpenseCheck(companyFile),
    {
      workflow: 'sync_error_queue_check',
      company_file: companyFile.company_file_path,
      status: 'success',
      actions: [
        {
          name: 'sync_error_queue_check',
          status: 'done',
          message: 'Outbound sync queue is monitored locally in Phase 1.',
          timestamp: new Date().toISOString(),
        },
      ],
    },
  ];
}
