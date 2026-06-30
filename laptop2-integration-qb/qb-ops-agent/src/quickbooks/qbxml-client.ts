export interface QbXmlRequestOptions {
  companyFilePath?: string;
  requestXml: string;
}

export interface QbXmlResponse {
  success: boolean;
  rawResponse: string | null;
  message: string;
}

/**
 * Phase 1 placeholder for QuickBooks SDK / QBXML integration.
 * This client is intentionally read-only and non-invasive for initial deployment.
 */
export async function sendQbXmlRequest(options: QbXmlRequestOptions): Promise<QbXmlResponse> {
  return {
    success: false,
    rawResponse: null,
    message: `QBXML client not enabled in Phase 1. Intended target: ${options.companyFilePath || 'default company file'}`,
  };
}

export async function testQbSdkConnectivity(): Promise<QbXmlResponse> {
  return {
    success: false,
    rawResponse: null,
    message: 'QuickBooks SDK/Web Connector connectivity is planned for Phase 2 read-only checks.',
  };
}
