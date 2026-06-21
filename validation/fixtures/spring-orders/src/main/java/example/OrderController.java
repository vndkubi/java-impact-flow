package example;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/orders")
class OrderController {
  private final OrderService service = new OrderService();

  @GetMapping("")
  String listOrders() {
    return service.findOrders();
  }
}
