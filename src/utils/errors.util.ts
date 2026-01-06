export class AppError extends Error{
    statusCode: number;
    isOperational: boolean;

    constructor(message:string, statusCode:number=500){
        super(message);
        this.statusCode= statusCode;
        this.isOperational= true;

        Error.captureStackTrace(this, this.constructor);
    }

}

export class ValidationError extends AppError{
    errors?: any;
    constructor(message:string, errors?:any, statusCode:number=400){
        super(message, 400);
        this.errors=errors;
        this.name= 'ValidationError';
    }
}
export class NotFoundError extends AppError{
    errors?: any;
    constructor(message:string="Resource not found", errors?: any){
        super(message, 404);
        this.errors = errors;
        this.name= 'NotFoundError';
    }
}
export class UnauthorizedError extends AppError{
    constructor(message:string="Unauthorized"){
        super(message, 401);
        this.name='UnauthorizedError';
}
}

export class ForbiddenError extends AppError{
    constructor(message:string ="Forbidden"){
        super(message,403);
        this.name='ForbiddenError';
    }
}
 export class ConflictError extends AppError{
    constructor(message:string="Conflict"){
        super(message,409);
        this.name='ConflictError';
    }
 }

 export interface ErrorResponse{
    error: string;
    message: string;
    details?: any;
    stack?: string;
 }

 export const formatError= (err:any):ErrorResponse =>{
    const isDevelopment= process.env.NODE_ENV ==='development';

    // Handle PayoutError instances (check for PayoutError characteristics)
    // PayoutError has: code, statusCode, and details properties
    if (err?.code && err?.statusCode && typeof err.statusCode === 'number' && err.name === 'PayoutError') {
        const response:ErrorResponse={
            error: err.code || 'PayoutError',
            message: err.message || 'An error occurred',
        };
        if (err.details) {
            response.details = err.details;
        }
        if (isDevelopment && err.stack){
            response.stack= err.stack;
        }
        return response;
    }

    if(err instanceof AppError && err.isOperational){
        const response:ErrorResponse={
            error: err.name || 'AppError',
            message: err.message || 'An error occurred',
        };
        if( err instanceof ValidationError && err.errors){
            response.details=err.errors;
        }
        if (isDevelopment && err.stack){
            response.stack= err.stack;
        }
        // Ensure we always return a valid response object
        if (!response.error || !response.message) {
            return {
                error: 'AppError',
                message: err.message || 'An error occurred',
            };
        }
        return response;
    }

    const errorMessage = err?.message || 'Something went wrong!';
    const response: ErrorResponse = {
        error: 'Internal Server Error',
        message: isDevelopment ? errorMessage : 'Please try again later.',
    };
    
    if (isDevelopment && err?.stack) {
        response.stack = err.stack;
    }
    
    // Final safeguard - ensure we never return an empty object
    if (!response.error || !response.message) {
        return {
            error: 'Internal Server Error',
            message: 'An unexpected error occurred',
        };
    }
    
    return response;
 };