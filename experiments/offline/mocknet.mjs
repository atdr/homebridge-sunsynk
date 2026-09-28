// Container has no IPv6: route matter.js through its in-memory network simulator.
import { Environment, Network, MockNetwork, NetworkSimulator } from '@matter/main';
Environment.default.set(Network, new MockNetwork(new NetworkSimulator(), '00:11:22:33:44:55', ['10.0.0.2', 'fdce::2']));
