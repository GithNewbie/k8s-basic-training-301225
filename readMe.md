# Kubernetes Hands‑On: Single‑Node Kind Cluster — Project Demo

Purpose  
Reproduce a local Kubernetes lab using Kind and the provided `project` app (Node.js backend + static frontend). Follow steps to create a cluster, deploy apps, expose them via Service/Ingress, add probes/limits, enable HPA, perform rollouts/rollback and run multi‑app routing (v1/v2).

Requirements (restated)
1. Create a Single‑Node Kind Cluster (https://kind.sigs.k8s.io/)  
2. Deploy a simple Node.js app (app1 / backend)  
3. Expose it: ClusterIP → NodePort/Ingress  
4. Add resource limits + liveness/readiness probes  
5. Enable autoscaling (HPA) via metrics-server  
6. Deploy new app1 image (new version)  
7. Rollback old image  
8. Single cluster, multi‑app:
   - deploy new frontend (vuejs) image and new backend image (v2)
   - service‑to‑service communication (frontend → app1)
   - Ingress routing for multiple apps (/ , /v2, /api)

Repository layout (important files)
- project/backend/Dockerfile, project/backend/server.js  
- project/backend-v2/Dockerfile, project/backend/server.js  
- project/frontend/Dockerfile, project/frontend/index.html  
- ./backend-deployment.yaml  
- ./backend-service.yaml  
- ./backend-v2-deployment.yaml  
- ./backend-v2-service.yaml
- ./frontend-deployment.yaml  
- ./frontend-service.yaml  
- ./ingress.yaml  
- ./backend-hpa.yaml  
- ./kind-config.yaml  

Prerequisites
- Docker (running)  
- kind (installed)  
- kubectl (installed and configured to use the Kind cluster)  
- PowerShell or bash (examples below use PowerShell syntax where relevant)

Quick workflow (commands — run from repo root)

1) Create Kind cluster
```powershell
kind create cluster --name k8s-learning --config ./kind-config.yaml --image kindest/node:v1.29.2
kubectl cluster-info
kubectl get nodes
```

2) Build images (backend + frontend v1 and v2)
```powershell
cd ./project

# build backend
docker build -t my-backend:v1 ./backend

# build backend-v2 image
docker build -t my-backend:v2 ./backend-v2

# build frontend v1
docker build -t my-frontend:v1 ./frontend

# create a quick frontend v2 (temporary edit or use a different Dockerfile/context)
# (example: modify index.html to show "v2" then build)
docker build -t my-frontend:v2 ./frontend
```

3) Load images into Kind (required for local images)
```powershell
kind load docker-image my-backend:v1 --name k8s-learning
kind load docker-image my-backend:v2 --name k8s-learning
kind load docker-image my-frontend:v1 --name k8s-learning
kind load docker-image my-frontend:v2 --name k8s-learning
```

4) Apply Deployments & Services
```powershell
kubectl apply -f ./backend-deployment.yaml
kubectl apply -f ./backend-service.yaml
kubectl apply -f ./backend-v2-deployment.yaml
kubectl apply -f ./backend-v2-service.yaml
kubectl apply -f ./frontend-deployment.yaml
kubectl apply -f ./frontend-service.yaml
kubectl get deploy,svc,pods -o wide
```

Test
```powershell
kubectl get po,svc,ingress -o wide
kubectl get endpoints project-backend-service project-backend-v2-service
kubectl get endpoints project-backend-service project-backend-v2-service project-frontend-service
```

5) Install Ingress Controller (nginx for Kind) and apply Ingress
```powershell
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl get pods -n ingress-nginx --watch
# once ingress-nginx pods are Ready:
kubectl apply -f ./ingress.yaml
kubectl get ingress
```

Test via host (after ingress-nginx Ready)
```powershell
curl http://localhost/api/data    # backend
curl http://localhost/api/v2      # backend-v2
curl http://localhost/api/v2/api/data # backend-v2 -> Call backend
curl http://localhost/            # frontend v1
curl http://localhost/v2          # frontend v2 (if configured)
```

If Ingress not available, debug or port‑forward:
```powershell
kubectl port-forward svc/project-backend-service 3000:80
curl http://localhost:3000/api/data

kubectl port-forward svc/project-frontend-service 8080:80
start http://localhost:8080
```

6) Add Resource limits and probes  
- Edit the deployment manifests to include `resources.requests`/`limits` and `livenessProbe` / `readinessProbe` for each container. Example (add to container spec):
```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "500m"
    memory: "256Mi"
livenessProbe:
  httpGet:
    path: /healthz
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /api/data
    port: 3000
  initialDelaySeconds: 2
  periodSeconds: 5
```
Apply updated manifests:
```powershell
kubectl apply -f ./backend-deployment.yaml
kubectl apply -f ./frontend-deployment.yaml
```

7) Enable HPA (metrics-server)
```powershell
# install metrics-server
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# patch for kind TLS if necessary
kubectl patch -n kube-system deployment metrics-server --type=json -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
kubectl rollout status deployment/metrics-server -n kube-system

# apply HPA
kubectl apply -f ./backend-hpa.yaml
kubectl get hpa
```

8) Create load to trigger HPA (run in other terminal)
```powershell
kubectl run -it --rm load-generator --image=curlimages/curl --restart=Never -- /bin/sh -c "while true; do curl -s http://project-backend-service/api/data >/dev/null; sleep 0.1; done"
# monitor:
kubectl get hpa -w
kubectl get pods -l app=project-backend --watch
```

9) Deploy new backend/frontend versions and routing options
Option A — Rolling update (replace image on same Deployment):
```powershell
# ensure my-frontend:v2 is loaded into kind
kind load docker-image my-frontend:v2 --name k8s-learning
kubectl set image deployment/project-frontend frontend=my-frontend:v2
kubectl rollout status deployment/project-frontend
```

Option B — Multi‑app parallel (keep v1 + v2 running)
- Create new Deployment/Service for v2 (e.g. `project-frontend-v2`, `project-frontend-v2-service`) and add Ingress path `/v2` to route to it. Apply those manifests, then:
```powershell
kubectl apply -f ./frontend-v2-deployment.yaml
kubectl apply -f ./frontend-v2-service.yaml
kubectl apply -f ./ingress.yaml  # updated with /v2 path
curl http://localhost/      # v1
curl http://localhost/v2    # v2
```

10) Rollback
```powershell
# rollback a deployment to previous revision
kubectl rollout undo deployment/project-frontend
kubectl rollout status deployment/project-frontend
```

Service‑to‑service test (from inside cluster)
```powershell
kubectl run --rm -it curl-test --image=curlimages/curl --restart=Never -- /bin/sh -c "curl -v http://project-backend-service/api/data && echo"
# or exec from frontend pod
kubectl exec -it <frontend-pod-name> -- wget -qO- http://project-backend-service/api/data
```

Debug checklist
- Are pods Ready? kubectl get pods -o wide  
- Are services exposing endpoints? kubectl get endpoints <svc>  
- Ingress controller running? kubectl get pods -n ingress-nginx  
- Ingress routes correct? kubectl describe ingress <name>  
- Metrics API available? kubectl top pods (requires metrics-server)  
- Logs: kubectl logs <pod> or kubectl logs -l app=<app>

Cleanup
```powershell
kubectl delete -f ./backend-hpa.yaml
kubectl delete -f ./ingress.yaml
kubectl delete -f ./frontend-deployment.yaml
kubectl delete -f ./frontend-service.yaml
kubectl delete -f ./backend-deployment.yaml
kubectl delete -f ./backend-service.yaml

# delete kind cluster
kind delete cluster --name k8s-learning
```

Notes
- Use relative paths in commands; do not hardcode local absolute paths.  
- For Kind, `imagePullPolicy: Never` is recommended for loaded local images.  
- For production or CI, push images to a registry and update manifests accordingly.