import { CompanyFileRecord } from '../storage/local-db';
import { WorkflowResult } from '../quickbooks/workflows';

export async function runBankFeedCheck(companyFile: CompanyFileRecord): Promise<WorkflowResult> {
  return {
    workflow: 'bank_feed_check',
    company_file: companyFile.company_file_path,
    status: 'warning',
    actions: [
      {
        name: 'bank_feed_check',
        status: 'needs_user',
        message: 'Bank feed download status is not read directly in Phase 1; prompt manual confirmation when needed.',
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
