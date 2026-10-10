export const handler = async () => ({statusCode: 410, headers: {"Content-Type": "application/json"}, body: JSON.stringify({error: "The tester program has ended. Open SupportFlow at /app."})});
