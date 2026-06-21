package example;

class OrderControllerTest {
  void coversOrderListing() {
    new OrderController().listOrders();
    new OrderService().findOrders();
  }
}
