export {};

declare global {
  namespace Express {
    interface UserPayload {
      userId: string;
      email: string;
      roles: string[];
      restaurantIds: string[];
    }
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: Express.UserPayload;
  }
}
