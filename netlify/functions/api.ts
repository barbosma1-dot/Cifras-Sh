import serverless from 'serverless-http';
import { appPromise } from '../../server';

let serverlessHandler: any;

export const handler = async (event: any, context: any) => {
  if (!serverlessHandler) {
    const app = await appPromise;
    serverlessHandler = serverless(app);
  }
  return serverlessHandler(event, context);
};
