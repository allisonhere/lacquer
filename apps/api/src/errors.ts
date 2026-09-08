export class ApiFault extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const notFound = () =>
  new ApiFault(404, 'NOT_FOUND', 'Resource not found.');
