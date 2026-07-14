import { Client } from '@langchain/langgraph-sdk';

export const agentClient = new Client({ apiUrl: '/agent' });