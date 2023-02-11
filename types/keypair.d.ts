declare module 'keypair' {
    function Keypair(options: { bits: number }): { private: string, public: string };
    export = Keypair;
}
