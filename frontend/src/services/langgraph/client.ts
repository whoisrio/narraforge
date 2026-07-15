import { Client } from '@langchain/langgraph-sdk';

const apiUrl = typeof window !== 'undefined' ? `${window.location.origin}/agent` : '/agent';

export const agentClient = new Client({ apiUrl });