import { CompanyFileRecord } from '../storage/local-db';
import { WorkflowResult } from '../quickbooks/workflows';

export async function runSalesReceiptCheck(companyFile: CompanyFileRecord): Promise<WorkflowResult> {
  return {
    workflow: 'sales_receipt_check',
    company_file: companyFile.company_file_path,
    status: 'warning',
    actions: [
      {
        name: 'sales_receipt_check',
        status: 'needs_user',
        message: 'Sales receipt verification requires manual review or future QBSDK read-only integration.',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
