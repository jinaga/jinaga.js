class ServiceInstance {
    promise: Promise<void> | null = null;
}

export class ServiceRunner {
    private services: ServiceInstance[] = [];
    
    constructor(
        private error: (exception: any) => void = _ => { }
    ) { }

    run(service: () => Promise<void>) {
        const instance = new ServiceInstance();
        this.services.push(instance);
        try {
            const promise = service()
                .then(() => {
                    this.succeed(instance);
                })
                .catch(x => {
                    this.fail(instance, x);
                });
            instance.promise = promise;
        }
        catch (x) {
            this.fail(instance, x);
        }
    }

    all() {
        return Promise.all(this.services.filter(s => s.promise).map(s => s.promise));
    }

    private succeed(instance: ServiceInstance) {
        this.remove(instance);
    }

    private fail(instance: ServiceInstance, exception: any) {
        this.error(exception);
        this.remove(instance);
    }

    private remove(instance: ServiceInstance) {
        const index = this.services.indexOf(instance);
        if (index >= 0)
            this.services.splice(index, 1);
    }
}
