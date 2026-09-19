abstract final class LuckyGiftPolicy {
 static const targetRtp=0.70;
 static const prices={100,200,500,600,1000,2500,5000,6000,10000,25000,50000};
 static final Set<double> multipliers={0.5,1.0,2.0,5.0,10.0,50.0,100.0};
 static void validatePrice(int coins){if(!prices.contains(coins))throw ArgumentError('unsupported lucky gift price');}
}
