class DistributorErrors {
    static errNotEnoughFunds: Error = new Error(
        'Not enough funds to execute stress cycle'
    );
}

export default DistributorErrors;
