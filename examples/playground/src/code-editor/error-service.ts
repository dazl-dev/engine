export class ErrorService {
    private errors: string[] = [];
    private handlers: Array<() => void> = [];
    public report(error: string) {
        this.errors.push(error);
        this.handlers.forEach((fn) => fn());
    }
    public getErrors() {
        return this.errors;
    }
    public listen(handler: () => void) {
        this.handlers.push(handler);
    }
}
