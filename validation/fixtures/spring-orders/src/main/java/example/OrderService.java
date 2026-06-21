package example;

class OrderService {
  private final OrderRepository repository = new OrderRepository();

  String findOrders() {
    return repository.findAll();
  }
}
