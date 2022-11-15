class RuntimeErrors {
    static errUnknownRuntime: Error = new Error('Unknown runtime specified');
    static errRuntimeNotInitialized: Error = new Error(
        'Runtime not initialized'
    );
}

export default RuntimeErrors;
