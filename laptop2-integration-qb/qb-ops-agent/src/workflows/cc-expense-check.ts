import { CompanyFileRecord } from '../storage/local-db';
import { WorkflowResult } from '../quickbooks/workflows';

export async function runCcExpenseCheck(companyFile: CompanyFileRecord): Promise<WorkflowResult> {
  return {
    workflow: 'cc_expense_check',
    company_file: companyFile.company_file_path,
    status: 'warning',
    actions: [
      {
        name: 'cc_expense_check',
        status: 'needs_user',
        message: 'Credit card expense review remains manual in Phase 1 monitoring mode.',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
